import { Types } from 'mongoose'
import Campaign, { ICampaign, IProgressColumn } from './campaign.model'
import Application, { IApplication } from '../applications/application.model'
import Submission, { ISubmission } from '../submissions/submission.model'
import Creator, { ICreator } from '../creators/creator.model'
import PicUser from '../pic/pic.model'
import '../../models/Brand' // daftarkan model untuk populate('brandId')
import { campaignSheetColumns, campaignSheetRow, creatorAccess, progressKind, CellKind, SheetColumn, BASE_SUBMISSION_COLUMNS } from '../../lib/sheetSync.service'
import { portalUrl } from './progress.service'

/**
 * Tabel ala spreadsheet untuk halaman "Sheet" admin (Master / Report / Recap Payment).
 * Dibangun dari DB, sumber yang sama dengan sync ke Google Sheets, jadi tetap jalan
 * tanpa kredensial Google dan tidak kena kuota API tiap admin buka halaman.
 */
export type SheetKind = 'master' | 'report' | 'recap' | 'applicants'
export const SHEET_KINDS: SheetKind[] = ['master', 'report', 'recap', 'applicants']

type Cell = string | number
export interface SheetTable {
  headers: string[]
  rows: Cell[][]
  /** Baris total (bold, nempel di bawah). Panjang = headers. */
  totals?: Cell[]
  /** Master & Pendaftar: metadata per kolom (sejajar headers) + id application per baris,
   * dipakai frontend untuk edit sel progress / tombol approve-reject. */
  columns?: ColumnMeta[]
  rowIds?: string[]
  rowStatus?: string[]
  /** Pendaftar: magic link portal per baris (bukan kolom, dipakai tombol salin "Link") */
  rowLinks?: string[]
  /** Master: catatan revisi terakhir draft & posting per baris (ditampilkan di sel Status) */
  rowNotes?: { draft?: string; post?: string }[]
  /** Master: definisi kolom progress mentah, untuk panel Kelola Kolom */
  progressColumns?: IProgressColumn[]
}

export interface ColumnMeta {
  key: string
  /** Ada = sel bisa diedit (kolom progress); id kolom progress-nya */
  progressId?: string
  kind?: CellKind
  /** Aturan akses creator (portal magic link), ditampilkan & diatur di admin */
  access: 'hidden' | 'view' | 'edit'
  /** Kolom bawaan Draft / Link Posting / status-nya (bukan kolom progress), diisi & di-review admin */
  submission?: { type: 'draft' | 'post'; review?: true }
}

const columnKind = (c: SheetColumn): CellKind | undefined => (c.progress ? progressKind(c.progress) : BASE_SUBMISSION_COLUMNS[c.key]?.kind)

const fmtDate = (d?: Date) => (d ? d.toISOString().slice(0, 10) : '')
const sum = (rows: Cell[][], col: number) => rows.reduce((acc, r) => acc + (typeof r[col] === 'number' ? (r[col] as number) : 0), 0)

async function loadCampaignData(tenantId: Types.ObjectId | string, campaign: ICampaign) {
  const applications = await Application.find({ tenantId, campaignId: campaign._id }).sort({ createdAt: 1 })
  const [creators, submissions, pics] = await Promise.all([
    Creator.find({ tenantId, _id: { $in: applications.map((a) => a.creatorId) } }).select('name phone email bankAccount npwp niches domicile socials'),
    Submission.find({ tenantId, campaignId: campaign._id }).sort({ createdAt: -1 }),
    PicUser.find({ tenantId, _id: { $in: applications.map((a) => a.picUserId).filter(Boolean) } }).select('name'),
  ])
  const creatorById = new Map(creators.map((c) => [String(c._id), c]))
  const picById = new Map(pics.map((p) => [String(p._id), p.name]))
  // submissions urut terbaru dulu → entry pertama per creator = terbaru (sama dgn sync ke Sheet)
  const submissionsByCreator = new Map<string, ISubmission[]>()
  for (const s of submissions) {
    const k = String(s.creatorId)
    submissionsByCreator.set(k, [...(submissionsByCreator.get(k) || []), s])
  }
  return { applications, creatorById, picById, submissions, submissionsByCreator }
}
type CampaignData = Awaited<ReturnType<typeof loadCampaignData>>

function masterRow(campaign: ICampaign, d: CampaignData, a: CampaignData['applications'][number]): Cell[] {
  return campaignSheetRow(
    campaign,
    a,
    d.creatorById.get(String(a.creatorId)) ?? null,
    d.submissionsByCreator.get(String(a.creatorId)) ?? [],
    a.picUserId ? d.picById.get(String(a.picUserId)) : undefined
  )
}

/** Master: hanya creator yang sudah di-approve di tab Pendaftar (sama dengan yang disync ke Google Sheets). */
function masterTable(campaign: ICampaign, d: CampaignData): SheetTable {
  const cols = campaignSheetColumns(campaign)
  const accepted = d.applications.filter((a) => a.status === 'accepted')
  return {
    headers: cols.map((c) => c.label),
    columns: cols.map((c) => ({
      key: c.key,
      progressId: c.progress?.id,
      kind: columnKind(c),
      access: creatorAccess(campaign, c),
      submission: c.progress ? undefined : BASE_SUBMISSION_COLUMNS[c.key] && { type: BASE_SUBMISSION_COLUMNS[c.key].type, review: BASE_SUBMISSION_COLUMNS[c.key].review },
    })),
    rows: accepted.map((a) => masterRow(campaign, d, a)),
    rowIds: accepted.map((a) => String(a._id)),
    rowNotes: accepted.map((a) => {
      const subs = d.submissionsByCreator.get(String(a.creatorId)) ?? []
      return { draft: subs.find((s) => s.type === 'draft')?.revisionNotes, post: subs.find((s) => s.type === 'post')?.revisionNotes }
    }),
    progressColumns: campaign.progressColumns || [],
  }
}

const CURATION_LABELS: Record<string, string> = {
  highly_recommended: 'Highly Recommended', recommended: 'Recommended', need_review: 'Need Review', rejected: 'Rejected',
}

/** Tab Pendaftar: semua yang apply + kolom aksi "Status" di frontend (badge + approve/reject/salin link, dari
 * rowIds/rowStatus/rowLinks), makanya status tidak dijadikan kolom teks lagi.
 * Link portal sengaja bukan kolom, cuma lewat tombol "Link" di baris yang sudah diterima. */
function applicantsTable(campaign: ICampaign, d: CampaignData): SheetTable {
  const custom = campaign.customFields || []
  // Kolom ikut field form apply campaign ini: niche, domisili (kalau ada kriteria provinsi/kota), akun per platform
  const platforms = campaign.criteria?.platforms || []
  const askDomicile = (campaign.criteria?.provinces?.length || 0) + (campaign.criteria?.cities?.length || 0) > 0
  const PLATFORM_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', threads: 'Threads', x: 'X' }
  const headers = [
    'Creator', 'WhatsApp', 'Email', 'Niche', ...(askDomicile ? ['Provinsi', 'Kota'] : []),
    ...platforms.flatMap((p) => [`${PLATFORM_LABEL[p] ?? p}`, `Followers ${PLATFORM_LABEL[p] ?? p}`]),
    'PIC/Partner', 'Handle By', ...custom.map((f) => f.label), 'Hasil Kurasi', 'Alasan Kurasi', 'Tanggal Daftar',
  ]
  const rows: Cell[][] = d.applications.map((a) => {
    const c = d.creatorById.get(String(a.creatorId))
    const ans = (id: string) => {
      const v = a.customAnswers?.[id]
      return Array.isArray(v) ? v.join(', ') : v || ''
    }
    return [
      c?.name || '', c?.phone || '', c?.email || '',
      (c?.niches || []).join(', '),
      ...(askDomicile ? [c?.domicile?.province || '', c?.domicile?.city || ''] : []),
      ...platforms.flatMap((p) => {
        const acc = c?.socials?.find((x) => x.platform === p)
        return [acc?.username ? `@${acc.username}` : '', acc ? acc.followers : '']
      }),
      a.picUserId ? d.picById.get(String(a.picUserId)) || '' : '',
      a.handleBy || '',
      ...custom.map((f) => ans(f.id)),
      CURATION_LABELS[a.curationResult] || a.curationResult,
      a.curationReason || '',
      fmtDate(a.createdAt),
    ]
  })
  return {
    headers, rows,
    rowIds: d.applications.map((a) => String(a._id)),
    rowStatus: d.applications.map((a) => a.status),
    rowLinks: d.applications.map((a) => (a.status === 'accepted' && a.portalToken ? portalUrl(a.portalToken) : '')),
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

/** 1 baris per creator yang diterima, data transfer fee + status bayar. */
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
  const table = kind === 'master' ? masterTable(campaign, data)
    : kind === 'applicants' ? applicantsTable(campaign, data)
    : kind === 'report' ? reportTable(data)
    : recapTable(campaign, data)
  const brand = campaign.brandId as unknown as { namaBrand?: string } | null
  return { campaign: { _id: campaign._id, name: campaign.name, brandName: brand?.namaBrand ?? null }, ...table }
}

/** Sel portal: draft creator lain disamarkan (belum tayang). Status review dikirim mentah, frontend
 * yang menampilkan badge + catatan revisi (rows[].notes). */
function portalCell(key: string, v: Cell, isMine: boolean): Cell {
  return key === 'Draft' && v !== '' && !isMine ? 'Terkirim' : v
}

/** Siapa yang membuka dashboard campaign: creator (magic link, isi baris sendiri), PIC (lihat saja),
 * client (lihat + approve/revisi draft & posting). */
export type BoardViewer = { role: 'creator'; mine: IApplication } | { role: 'pic' } | { role: 'client' }

/**
 * Tabel dashboard creator / PIC / client: creator yang diterima saja, kolom yang terlihat = aturan
 * akses creator dari admin, kolom tersembunyi dibuang di server (bukan cuma disembunyikan di UI).
 * Creator: sel 'edit' cuma di baris sendiri, draft & catatan revisi creator lain disamarkan. Status
 * review dikirim mentah + catatan (rows[].notes), tombol approve/revisi cuma di dashboard client.
 */
export async function buildPortalView(tenantId: Types.ObjectId | string, campaign: ICampaign, viewer: BoardViewer) {
  const data = await loadCampaignData(tenantId, campaign)
  const cols = campaignSheetColumns(campaign)
  const visible = cols.map((c, i) => ({ c, i, access: creatorAccess(campaign, c) })).filter((x) => x.access !== 'hidden')
  const mineId = viewer.role === 'creator' ? String(viewer.mine._id) : null
  // Baris sendiri paling atas supaya creator langsung ketemu
  const accepted = data.applications.filter((a) => a.status === 'accepted')
    .sort((a, b) => Number(String(b._id) === mineId) - Number(String(a._id) === mineId))
  return {
    headers: visible.map((x) => x.c.label),
    columns: visible.map((x) => ({
      key: x.c.key,
      progressId: x.c.progress?.id ?? BASE_SUBMISSION_COLUMNS[x.c.key]?.id,
      kind: columnKind(x.c),
      editable: viewer.role === 'creator' && x.access === 'edit',
      // Kolom status review: badge + catatan revisi di semua dashboard, tombol approve/revisi cuma di client
      review: !x.c.progress && BASE_SUBMISSION_COLUMNS[x.c.key]?.review ? BASE_SUBMISSION_COLUMNS[x.c.key].type : undefined,
    })),
    rows: accepted.map((a) => {
      const full = masterRow(campaign, data, a)
      const isMine = String(a._id) === mineId
      const subs = data.submissionsByCreator.get(String(a.creatorId)) ?? []
      return {
        id: String(a._id),
        mine: isMine,
        cells: visible.map((x) => portalCell(x.c.key, full[x.i] ?? '', viewer.role !== 'creator' || isMine)),
        // Catatan revisi creator lain tidak dibagikan ke sesama creator
        notes: viewer.role !== 'creator' || isMine
          ? { draft: subs.find((s) => s.type === 'draft')?.revisionNotes, post: subs.find((s) => s.type === 'post')?.revisionNotes }
          : undefined,
      }
    }),
  }
}
