import crypto from 'crypto'
import { Types } from 'mongoose'
import { ICampaign, IProgressColumn } from './campaign.model'
import { IApplication } from '../applications/application.model'
import Submission, { ISubmission } from '../submissions/submission.model'
import { tryAutoTransition } from './workflow.service'
import { uploadToCloudinary } from '../../lib/cloudinary'
import { progressKind, CellKind, syncApplicationToSheet, syncSubmissionToSheet } from '../../lib/sheetSync.service'
import { env } from '../../config/env'

/**
 * Edit sel kolom progress di tabel (Master Sheet admin & portal creator). Kolom yang diikat ke
 * Submission menulis ke Submission yang sama dengan yang dulu diisi lewat form upload — jadi
 * Report, analytics, workflow 17 tahap & ekstensi KOL Lister tetap jalan tanpa perubahan.
 */

export type Actor = 'admin' | 'creator'

/** Error yang pesannya aman ditampilkan ke user (400/403), beda dari error server biasa. */
export class CellError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

interface CellContext {
  tenantId: Types.ObjectId | string
  campaign: ICampaign
  application: IApplication
  columnId: string
  actor: Actor
  /** User admin / creator yang melakukan edit — dicatat di WorkflowAudit lewat tryAutoTransition */
  userId: Types.ObjectId | string
}

function findColumn(ctx: CellContext): IProgressColumn {
  const col = (ctx.campaign.progressColumns || []).find((c) => c.id === ctx.columnId)
  if (!col) throw new CellError('Kolom tidak ditemukan', 404)
  if (ctx.actor === 'creator') {
    if (col.creatorAccess !== 'edit') throw new CellError('Kolom ini tidak bisa kamu edit', 403)
    if (ctx.application.status !== 'accepted') throw new CellError('Kamu belum diterima di campaign ini', 403)
  }
  return col
}

/** '' / null = kosongkan sel. Angka metrik boleh pakai pemisah ribuan ("12.500"). */
export function normalizeCell(kind: CellKind, raw: unknown, metric: boolean): string | number | undefined {
  if (raw === null || raw === undefined) return undefined
  const v = String(raw).trim()
  if (!v) return undefined
  if (kind === 'number') {
    const n = metric ? Number(v.replace(/[.,\s]/g, '')) : Number(v.replace(',', '.'))
    if (!Number.isFinite(n) || (metric && n < 0)) throw new CellError('Isi dengan angka')
    return n
  }
  if (kind === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new CellError('Format tanggal YYYY-MM-DD')
    return v
  }
  if (kind === 'link') {
    if (!/^https?:\/\/\S+$/i.test(v) || v.length > 500) throw new CellError('Isi dengan link lengkap (https://...)')
    return v
  }
  if (kind === 'file') throw new CellError('Kolom ini diisi lewat upload file')
  if (v.length > 1000) throw new CellError('Maksimal 1000 karakter')
  return v
}

async function findOrCreateSubmission(ctx: CellContext, col: IProgressColumn, create: boolean): Promise<ISubmission | null> {
  const b = col.submission!
  const existing = await Submission.findOne({
    tenantId: ctx.tenantId, campaignId: ctx.campaign._id, creatorId: ctx.application.creatorId, type: b.type, platform: b.platform,
  }).sort({ createdAt: -1 })
  if (existing || !create) return existing
  return new Submission({
    tenantId: ctx.tenantId, campaignId: ctx.campaign._id, creatorId: ctx.application.creatorId, type: b.type, platform: b.platform, insightScreenshotUrls: [],
  })
}

type Stage = Parameters<typeof tryAutoTransition>[0]['fromStage']
const transition = (ctx: CellContext, fromStage: Stage, toStage: Stage) =>
  tryAutoTransition({ campaignId: String(ctx.campaign._id), tenantId: String(ctx.tenantId), fromStage, toStage, userId: String(ctx.userId) })

export async function writeProgressCell(ctx: CellContext, raw: unknown): Promise<void> {
  const col = findColumn(ctx)
  const field = col.submission?.field
  const value = normalizeCell(progressKind(col), raw, Boolean(field && field !== 'link' && field !== 'postedAt'))

  if (!field) {
    const progress = { ...(ctx.application.progress || {}) }
    if (value === undefined) delete progress[col.id]
    else progress[col.id] = value
    ctx.application.progress = progress
    ctx.application.markModified('progress')
    await ctx.application.save()
    syncApplicationToSheet(ctx.application).catch((err) => console.error('Sheet sync error (application):', err))
    return
  }

  const sub = await findOrCreateSubmission(ctx, col, value !== undefined)
  if (!sub) return // mengosongkan sel yang memang belum ada submission-nya

  const hadLink = Boolean(sub.link)
  let resubmittedRevision = false
  if (field === 'link') {
    // Draft yang diminta revisi lalu linknya diganti = creator kirim ulang → balik ke review
    if (sub.type === 'draft' && sub.status === 'revision_requested' && value && value !== sub.link) {
      sub.status = 'submitted'
      sub.revisionCount = (sub.revisionCount || 0) + 1
      resubmittedRevision = true
    }
    sub.link = value as string | undefined
  } else if (field === 'postedAt') {
    sub.postedAt = value ? new Date(value as string) : undefined
  } else {
    const current = sub.parsedInsight || {}
    current[field as 'views'] = value as number | undefined
    // Angka dari creator belum terverifikasi; dari admin = koreksi + verifikasi (sama seperti PATCH /submissions/:id)
    current.verifiedByUserId = ctx.actor === 'admin' ? (ctx.userId as never) : undefined
    current.verifiedAt = ctx.actor === 'admin' ? new Date() : undefined
    sub.parsedInsight = current
  }
  await sub.save()
  syncSubmissionToSheet(sub).catch((err) => console.error('Sheet sync error (submission):', err))

  // AD-32: sama dengan alur form upload lama — link pertama kali masuk = submission terkirim
  if (field === 'link' && value && !hadLink) {
    if (sub.type === 'draft') await transition(ctx, 'waiting_draft', 'content_review')
    else {
      await transition(ctx, 'waiting_post', 'posted')
      await transition(ctx, 'posted', 'waiting_insight')
    }
  }
  if (resubmittedRevision) await transition(ctx, 'revision', 'content_review')
  if (field !== 'link' && field !== 'postedAt' && ctx.actor === 'admin' && value !== undefined) {
    await transition(ctx, 'waiting_insight', 'insight_collected')
  }
}

/** Kolom screenshot insight: file ditambahkan (bukan menimpa) ke Submission.insightScreenshotUrls. */
export async function appendScreenshots(ctx: CellContext, files: Express.Multer.File[]): Promise<void> {
  const col = findColumn(ctx)
  if (col.submission?.field !== 'screenshots') throw new CellError('Kolom ini bukan kolom upload screenshot')
  if (files.length === 0) throw new CellError('Pilih minimal 1 gambar')
  const urls = await Promise.all(files.map((f) => uploadToCloudinary(f.buffer, `submissions/${ctx.campaign._id}`)))
  const sub = (await findOrCreateSubmission(ctx, col, true))!
  sub.insightScreenshotUrls = [...(sub.insightScreenshotUrls || []), ...urls]
  await sub.save()
  syncSubmissionToSheet(sub).catch((err) => console.error('Sheet sync error (submission):', err))
}

export function portalUrl(token: string): string {
  return `${env.clientOrigin}/portal/${token}`
}

/** Token magic link dibuat sekali per application, dipakai ulang kalau sudah ada. */
export async function ensurePortalToken(application: IApplication): Promise<string> {
  if (application.portalToken) return application.portalToken
  application.portalToken = crypto.randomBytes(24).toString('base64url')
  await application.save()
  return application.portalToken
}
