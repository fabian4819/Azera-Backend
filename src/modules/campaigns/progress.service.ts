import crypto from 'crypto'
import { Types } from 'mongoose'
import { ICampaign, IProgressColumn } from './campaign.model'
import { IApplication } from '../applications/application.model'
import Submission, { ISubmission } from '../submissions/submission.model'
import { uploadToCloudinary } from '../../lib/cloudinary'
import { progressKind, CellKind, syncApplicationToSheet, syncSubmissionToSheet, BASE_SUBMISSION_COLUMNS, creatorAccess } from '../../lib/sheetSync.service'
import { env } from '../../config/env'

/**
 * Edit sel kolom progress di tabel (Master Sheet admin & portal creator). Kolom yang diikat ke
 * Submission menulis ke Submission yang sama dengan yang dulu diisi lewat form upload, jadi
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
  /** User admin / creator yang melakukan edit (admin = verifikator angka insight) */
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

/** Upload ke Cloudinary; gagal (kunci salah, jaringan, file ditolak) = pesan jelas ke user, detail ke log. */
async function uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
  try {
    return await uploadToCloudinary(file.buffer, folder)
  } catch (err) {
    console.error('Cloudinary upload error:', err)
    throw new CellError('Upload file gagal. Coba lagi, atau hubungi tim AzeraKOL kalau masih gagal.', 502)
  }
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
  if (kind === 'file' || kind === 'media') throw new CellError('Kolom ini diisi lewat upload file')
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

  if (field === 'link') {
    // Draft yang diminta revisi lalu linknya diganti = creator kirim ulang → balik ke review
    if (sub.type === 'draft' && sub.status === 'revision_requested' && value && value !== sub.link) {
      sub.status = 'submitted'
      sub.revisionCount = (sub.revisionCount || 0) + 1
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

}

/** Kolom screenshot insight: file ditambahkan (bukan menimpa) ke Submission.insightScreenshotUrls. */
export async function appendScreenshots(ctx: CellContext, files: Express.Multer.File[]): Promise<void> {
  const col = findColumn(ctx)
  if (col.submission?.field !== 'screenshots') throw new CellError('Kolom ini bukan kolom upload screenshot')
  if (files.length === 0) throw new CellError('Pilih minimal 1 gambar')
  const urls = await Promise.all(files.map((f) => uploadFile(f, `submissions/${ctx.campaign._id}`)))
  const sub = (await findOrCreateSubmission(ctx, col, true))!
  sub.insightScreenshotUrls = [...(sub.insightScreenshotUrls || []), ...urls]
  await sub.save()
  syncSubmissionToSheet(sub).catch((err) => console.error('Sheet sync error (submission):', err))
}

/* ---- Kolom bawaan Master Sheet: Draft (upload foto/video), Link Posting, dan approve/revisi keduanya ---- */

type SubmissionCtx = Omit<CellContext, 'columnId'>
type Platform = ISubmission['platform']

const PLATFORM_HOSTS: [RegExp, Platform][] = [
  [/instagram\.com/i, 'instagram'], [/tiktok\.com/i, 'tiktok'], [/threads\.(net|com)/i, 'threads'], [/(^|\/\/|\.)(x|twitter)\.com/i, 'x'],
]

export function platformFromLink(link: string): Platform | undefined {
  return PLATFORM_HOSTS.find(([re]) => re.test(link))?.[1]
}

function defaultPlatform(ctx: SubmissionCtx, link?: string): Platform {
  return (link && platformFromLink(link)) || (ctx.campaign.criteria?.platforms?.[0] as Platform | undefined) || 'instagram'
}

/** Submission terbaru tipe ini (platform apa pun), sama dengan yang ditampilkan di kolom bawaan. */
function latestOfType(ctx: SubmissionCtx, type: 'draft' | 'post') {
  return Submission.findOne({ tenantId: ctx.tenantId, campaignId: ctx.campaign._id, creatorId: ctx.application.creatorId, type }).sort({ createdAt: -1 })
}

/** Portal: kolom bawaan (base:draft/post/insight) hanya bisa diisi creator kalau aksesnya 'edit'. */
export function assertCreatorCanEditBase(campaign: ICampaign, columnId: string): void {
  const key = Object.keys(BASE_SUBMISSION_COLUMNS).find((k) => BASE_SUBMISSION_COLUMNS[k].id === columnId)
  if (!key || creatorAccess(campaign, { key, label: key }) !== 'edit') throw new CellError('Kolom ini tidak bisa kamu edit', 403)
}

/** Kiriman ulang setelah diminta revisi = balik ke antrean review. Creator yang mengganti konten
 * yang sudah di-approve juga balik ke review, supaya tidak bisa diam-diam menukar konten. */
function resubmit(sub: ISubmission, actor: Actor) {
  if (sub.status === 'revision_requested') {
    sub.status = 'submitted'
    sub.revisionCount = (sub.revisionCount || 0) + 1
  } else if (sub.status === 'approved' && actor === 'creator') {
    sub.status = 'submitted'
  }
}

export async function setPostingLink(ctx: SubmissionCtx, raw: unknown): Promise<void> {
  const link = normalizeCell('link', raw, false) as string | undefined
  let sub = await latestOfType(ctx, 'post')
  if (!sub) {
    if (!link) return
    sub = new Submission({
      tenantId: ctx.tenantId, campaignId: ctx.campaign._id, creatorId: ctx.application.creatorId, type: 'post', platform: defaultPlatform(ctx, link), insightScreenshotUrls: [],
    })
  }
  if (link && link !== sub.link) resubmit(sub, ctx.actor)
  sub.link = link
  if (link) sub.platform = defaultPlatform(ctx, link)
  await sub.save()
  syncSubmissionToSheet(sub).catch((err) => console.error('Sheet sync error (submission):', err))
}

/** Upload draft baru menggantikan file draft sebelumnya (versi revisi), bukan ditumpuk. */
export async function uploadDraftFiles(ctx: SubmissionCtx, files: Express.Multer.File[]): Promise<void> {
  if (files.length === 0) throw new CellError('Pilih minimal 1 file foto/video')
  const urls = await Promise.all(files.map((f) => uploadFile(f, `drafts/${ctx.campaign._id}`)))
  const sub = (await latestOfType(ctx, 'draft')) ?? new Submission({
    tenantId: ctx.tenantId, campaignId: ctx.campaign._id, creatorId: ctx.application.creatorId, type: 'draft', platform: defaultPlatform(ctx), insightScreenshotUrls: [],
  })
  if (!sub.isNew) resubmit(sub, ctx.actor)
  sub.mediaUrls = urls
  await sub.save()
  syncSubmissionToSheet(sub).catch((err) => console.error('Sheet sync error (submission):', err))
}

/** Kolom Insight: screenshot ditambahkan (bukan menimpa) ke posting terbaru, sama seperti kolom progress screenshot. */
export async function appendPostScreenshots(ctx: SubmissionCtx, files: Express.Multer.File[]): Promise<void> {
  if (files.length === 0) throw new CellError('Pilih minimal 1 gambar')
  const sub = await latestOfType(ctx, 'post')
  if (!sub) throw new CellError('Isi link posting dulu sebelum upload insight')
  const urls = await Promise.all(files.map((f) => uploadFile(f, `submissions/${ctx.campaign._id}`)))
  sub.insightScreenshotUrls = [...(sub.insightScreenshotUrls || []), ...urls]
  await sub.save()
  syncSubmissionToSheet(sub).catch((err) => console.error('Sheet sync error (submission):', err))
}

export async function reviewSubmission(ctx: SubmissionCtx, type: unknown, status: unknown, notes?: unknown): Promise<void> {
  if (type !== 'draft' && type !== 'post') throw new CellError('Tipe tidak dikenal')
  if (status !== 'approved' && status !== 'revision_requested') throw new CellError('Status tidak dikenal')
  const revisionNotes = String(notes ?? '').trim()
  if (status === 'revision_requested' && !revisionNotes) throw new CellError('Isi catatan revisinya dulu')
  if (revisionNotes.length > 1000) throw new CellError('Catatan revisi maksimal 1000 karakter')
  const sub = await latestOfType(ctx, type)
  if (!sub) throw new CellError(type === 'draft' ? 'Belum ada draft' : 'Belum ada link posting', 404)
  sub.status = status
  if (status === 'revision_requested') sub.revisionNotes = revisionNotes
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
