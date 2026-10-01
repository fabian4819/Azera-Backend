import { Types } from 'mongoose'
import Campaign, { ICampaign } from './campaign.model'
import Application from '../applications/application.model'
import Submission, { ISubmission } from '../submissions/submission.model'
import Creator, { ICreator } from '../creators/creator.model'
import PicUser from '../pic/pic.model'
import '../../models/Brand' // daftarkan model untuk populate('brandId')
import { campaignSheetHeaders, campaignSheetRow } from '../../lib/sheetSync.service'

/**
 * Tabel ala spreadsheet untuk halaman "Sheet" admin (Master / Report / Recap Payment).
 * Dibangun dari DB — sumber yang sama dengan sync ke Google Sheets — jadi tetap jalan
 * tanpa kredensial Google dan tidak kena kuota API tiap admin buka halaman.
 */
export type SheetKind = 'master' | 'report' | 'recap'
export const SHEET_KINDS: SheetKind[] = ['master', 'report', 'recap']

type Cell = string | number
export interface SheetTable {
  headers: string[]
  rows: Cell[][]
  /** Baris total (bold, nempel di bawah). Panjang = headers. */
  totals?: Cell[]
}

const fmtDate = (d?: Date) => (d ? d.toISOString().slice(0, 10) : '')
const sum = (rows: Cell[][], col: number) => rows.reduce((acc, r) => acc + (typeof r[col] === 'number' ? (r[col] as number) : 0), 0)

async function loadCampaignData(tenantId: Types.ObjectId | string, campaign: ICampaign) {
  const applications = await Application.find({ tenantId, campaignId: campaign._id }).sort({ createdAt: 1 })
  const [creators, submissions, pics] = await Promise.all([
    Creator.find({ tenantId, _id: { $in: applications.map((a) => a.creatorId) } }).select('name phone bankAccount npwp'),
    Submission.find({ tenantId, campaignId: campaign._id }).sort({ createdAt: -1 }),
    PicUser.find({ tenantId, _id: { $in: applications.map((a) => a.picUserId).filter(Boolean) } }).select('name'),
  ])
  const creatorById = new Map(creators.map((c) => [String(c._id), c]))
  const picById = new Map(pics.map((p) => [String(p._id), p.name]))
  // submissions urut terbaru dulu → entry pertama per creator = terbaru (sama dgn sync ke Sheet)
  const latestByCreator = new Map<string, ISubmission>()
  for (const s of submissions) if (!latestByCreator.has(String(s.creatorId))) latestByCreator.set(String(s.creatorId), s)
  return { applications, creatorById, picById, submissions, latestByCreator }
}
type CampaignData = Awaited<ReturnType<typeof loadCampaignData>>

function masterTable(campaign: ICampaign, d: CampaignData): SheetTable {
  return {
    headers: campaignSheetHeaders(campaign),
    rows: d.applications.map((a) =>
      campaignSheetRow(
        campaign,
        a,
        d.creatorById.get(String(a.creatorId)) ?? null,
        d.latestByCreator.get(String(a.creatorId)) ?? null,
        a.picUserId ? d.picById.get(String(a.picUserId)) : undefined
      )
    ),
  }
}

/** 1 baris per konten tayang (submission type post). ER = (like+comment+share+save)/views,
 * rumus sama dengan analytics.service.ts. */
function reportTable(d: CampaignData): SheetTable {
  const headers = ['Creator', 'Platform', 'Link Konten', 'Tanggal Tayang', 'Status', 'Views', 'Likes', 'Comments', 'Shares', 'Saves', 'Reach', 'ER (%)']
  const er = (views: number, eng: number) => (views > 0 ? Math.round((eng / views) * 10000) / 100 : '')
  const rows: Cell[][] = d.submissions.filter((s) => s.type === 'post').reverse().map((s) => {
    const i = s.parsedInsight
    return [
      d.creatorById.get(String(s.creatorId))?.name || '',
      s.platform,
      s.link || '',
      fmtDate(s.postedAt || s.createdAt),
      s.status,
      i?.views ?? '', i?.likes ?? '', i?.comments ?? '', i?.shares ?? '', i?.saves ?? '', i?.reach ?? '',
      er(i?.views ?? 0, (i?.likes ?? 0) + (i?.comments ?? 0) + (i?.shares ?? 0) + (i?.saves ?? 0)),
    ]
  })
  const views = sum(rows, 5)
  const eng = sum(rows, 6) + sum(rows, 7) + sum(rows, 8) + sum(rows, 9)
  return {
    headers,
    rows,
    totals: rows.length
      ? [`Total (${rows.length} konten)`, '', '', '', '', views, sum(rows, 6), sum(rows, 7), sum(rows, 8), sum(rows, 9), sum(rows, 10), er(views, eng)]
      : undefined,
  }
}

/** 1 baris per creator yang diterima — data transfer fee + status bayar. */
function recapTable(campaign: ICampaign, d: CampaignData): SheetTable {
  const headers = ['Creator', 'WhatsApp', 'Nama Bank', 'No. Rekening', 'Nama Pemilik Rekening', 'NPWP', 'Fee Creator', 'Status Pembayaran']
  const fee = campaign.fee?.creatorFee ?? 0
  const accepted = d.applications.filter((a) => a.status === 'accepted')
  const rows: Cell[][] = accepted.map((a) => {
    const c = d.creatorById.get(String(a.creatorId)) as ICreator | undefined
    return [
      c?.name || '', c?.phone || '',
      c?.bankAccount?.bankName || '', c?.bankAccount?.accountNumber || '', c?.bankAccount?.accountName || '',
      c?.npwp || '',
      fee || '',
      a.creatorPaymentStatus,
    ]
  })
  const paid = accepted.filter((a) => a.creatorPaymentStatus === 'paid').length
  return {
    headers,
    rows,
    totals: rows.length ? [`Total (${rows.length} creator)`, '', '', '', '', '', fee * rows.length, `${paid} paid · ${rows.length - paid} unpaid`] : undefined,
  }
}

export async function buildSheetView(tenantId: Types.ObjectId | string, campaignId: string, kind: SheetKind) {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId }).populate('brandId', 'namaBrand')
  if (!campaign) return null
  const data = await loadCampaignData(tenantId, campaign)
  const table = kind === 'master' ? masterTable(campaign, data) : kind === 'report' ? reportTable(data) : recapTable(campaign, data)
  const brand = campaign.brandId as unknown as { namaBrand?: string } | null
  return { campaign: { _id: campaign._id, name: campaign.name, brandName: brand?.namaBrand ?? null }, ...table }
}
