import { Types } from 'mongoose'
import { ICreator, SocialPlatform } from '../modules/creators/creator.model'
import { IApplication } from '../modules/applications/application.model'
import Application from '../modules/applications/application.model'
import { ISubmission } from '../modules/submissions/submission.model'
import Submission from '../modules/submissions/submission.model'
import Campaign, { ICampaign, IProgressColumn, CreatorAccess, SubmissionField } from '../modules/campaigns/campaign.model'
import Creator from '../modules/creators/creator.model'
import PicUser from '../modules/pic/pic.model'
import SocialSnapshot, { ISocialSnapshot } from '../modules/extension/socialSnapshot.model'
import { upsertCreatorRow, upsertCampaignRow, CAMPAIGN_HEADERS_BASE } from './googleSheets'
import { env } from '../config/env'

const GENDER_LABELS: Record<string, string> = {
  male: 'Laki-laki',
  female_hijab: 'Perempuan (Hijab)',
  female_non_hijab: 'Perempuan (Non-Hijab)',
}

const RATE_NEGO_LABELS: Record<string, string> = { yes: 'Bisa', no: 'Tidak', depends: 'Tergantung campaign' }

// Sama seperti complianceLabels di client/src/pages/admin/Creators.tsx — dipakai juga sebagai opsi
// dropdown Compliance di sheet, jadi labelnya harus sama persis dengan yang admin lihat di dashboard.
const COMPLIANCE_LABELS: Record<string, string> = { ok: 'OK', sp1: 'SP1', sp2_blacklist: 'Blacklist' }
const SOURCE_LABELS: Record<string, string> = { form: 'Form', extension: 'Ekstensi', campaign: 'Link Campaign', import: 'Import Sheet' }
const STATUS_LABELS: Record<string, string> = { pending: 'Pending', reviewing: 'Reviewing', approved: 'Approved', rejected: 'Rejected' }

// Label persis sama dengan array `activities` di client/src/pages/KOLRegister.tsx — supaya opsi
// dropdown chip yang di-setup manual di Sheets match dengan value yang ditulis ke sel.
const ACTIVITY_LABELS: Record<string, string> = {
  kol: 'KOL (Key Opinion Leader)',
  koc: 'KOC (Key Opinion Consumer)',
  ugc: 'UGC Creator',
  affiliator: 'Affiliator',
  live_streamer: 'Live Streamer',
}

// Sama dengan prefix di client/src/pages/KOLRegister.tsx buildProfileUrl() — dipakai kalau
// creator.socials[].profileUrl kosong (form KOL tidak lagi wajib isi link, cuma username).
const PLATFORM_URL_PREFIX: Record<SocialPlatform, string> = {
  instagram: 'https://instagram.com/',
  tiktok: 'https://tiktok.com/@',
  threads: 'https://threads.com/@',
  x: 'https://x.com/',
}

// ISO (yyyy-mm-dd) — semua tab sekarang USER_ENTERED, jadi Sheets parse ini sebagai tipe
// Date beneran, bukan teks.
const fmtDateISO = (d?: Date) => (d ? d.toISOString().slice(0, 10) : '')

const CREATOR_PLATFORMS: SocialPlatform[] = ['instagram', 'tiktok', 'threads', 'x']

function rateSummary(c: Pick<ICreator, 'rateEstimateType' | 'rateEstimateAmount'>): string {
  if (c.rateEstimateType === 'nominal' && c.rateEstimateAmount) return `Rp ${c.rateEstimateAmount.toLocaleString('id-ID')}`
  if (c.rateEstimateType === 'unknown') return 'Belum ada patokan'
  return ''
}

// Formula HYPERLINK, bukan URL polos — supaya sel muncul sebagai "@username" yang bisa diklik
// langsung ke profilnya (permintaan: "kyk link embed gitu"). Butuh valueInputOption USER_ENTERED
// di upsertCreatorRow supaya string ini dievaluasi sebagai formula, bukan teks literal.
function socialLinkFormula(social: { platform: SocialPlatform; username: string; profileUrl?: string } | undefined): string {
  if (!social || !social.username) return ''
  const handle = social.username.replace(/^@+/, '').trim()
  if (!handle) return ''
  const url = social.profileUrl || `${PLATFORM_URL_PREFIX[social.platform]}${handle}`
  const escape = (s: string) => s.replace(/"/g, "'")
  // Locale spreadsheet ini in_ID (Asia/Jakarta) — Sheets parse formula pakai pemisah argumen
  // ";" di locale Indonesia, BUKAN "," seperti locale US (kalau pakai koma: #ERROR! "Error
  // mengurai formula", ketauan pas ngecek langsung di sheet-nya).
  return `=HYPERLINK("${escape(url)}";"@${escape(handle)}")`
}

/** Link ke halaman CreatorDetail admin, dengan ?expand=<platform> supaya section "Metrik dari
 * Ekstensi" akun itu langsung kebuka begitu diklik dari Sheet — staf tidak perlu klik chevron
 * manual lagi. Kosong kalau belum pernah ditarik ekstensinya (tidak ada yang bisa dilihat). */
function extensionMetricsLink(creatorId: string, platform: SocialPlatform, snap: ISocialSnapshot | undefined): string {
  if (!snap) return ''
  const url = `${env.clientOrigin}/admin/creators/${creatorId}?expand=${platform}`
  const escape = (s: string) => s.replace(/"/g, "'")
  // Sama alasan pemisah ";" seperti socialLinkFormula() di atas — locale spreadsheet in_ID.
  return `=HYPERLINK("${escape(url)}";"Lihat Metrik")`
}

export async function syncCreatorToSheet(creator: ICreator): Promise<void> {
  // Snapshot ekstensi terbaru per platform (kalau pernah ditarik) — 1 query, dikelompokkan di memori
  // karena cuma 4 platform per creator, bukan pantas untuk 4 query terpisah.
  const snapshots = await SocialSnapshot.find({ tenantId: creator.tenantId, creatorId: creator._id }).sort({ createdAt: -1 })
  const latestByPlatform = new Map<SocialPlatform, ISocialSnapshot>()
  for (const snap of snapshots) {
    const p = snap.platform as SocialPlatform
    if (!latestByPlatform.has(p)) latestByPlatform.set(p, snap) // sudah sort createdAt desc → yang pertama = terbaru
  }

  const platformCells = CREATOR_PLATFORMS.flatMap((p) => [
    socialLinkFormula(creator.socials?.find((s) => s.platform === p)),
    extensionMetricsLink(String(creator._id), p, latestByPlatform.get(p)),
  ])

  const niche = [...(creator.niches || []), ...(creator.nicheOther ? [creator.nicheOther] : [])].join(', ')
  const gayaKonten = [...(creator.contentStyles || []), ...(creator.contentStyleOther ? [creator.contentStyleOther] : [])].join(', ')
  const aktivitas = (creator.activities || []).map((a) => ACTIVITY_LABELS[a] || a).join(', ')

  await upsertCreatorRow(creator.phone, [
    creator.name,
    creator.email || '',
    creator.age ?? '',
    creator.gender ? GENDER_LABELS[creator.gender] : '',
    creator.domicile?.city || '',
    creator.domicile?.province || '',
    niche,
    gayaKonten,
    aktivitas,
    ...platformCells,
    rateSummary(creator),
    creator.rateNegotiable ? RATE_NEGO_LABELS[creator.rateNegotiable] : '',
    creator.bankAccount?.bankName || '',
    creator.bankAccount?.accountNumber || '',
    creator.bankAccount?.accountName || '',
    creator.npwp || '',
    creator.portfolioLink || '',
    creator.cancelCount ?? 0,
    COMPLIANCE_LABELS[creator.complianceStatus] || creator.complianceStatus,
    SOURCE_LABELS[creator.source] || creator.source,
    STATUS_LABELS[creator.status] || creator.status,
    fmtDateISO(creator.createdAt),
  ])
}

/** Application + Submission sekarang gabung jadi 1 baris per creator di 1 tab per campaign
 * (bukan 2 tab terpisah) — jadi baik sync dari sisi Application maupun Submission harus
 * nulis ulang baris LENGKAP (Application selalu ada duluan karena Submission cuma bisa
 * dibuat creator yang sudah accepted; submission terbaru dipakai kalau lebih dari satu). */
function formatCustomAnswer(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.join(', ')
  return v || ''
}

export type CellKind = 'text' | 'number' | 'date' | 'link' | 'file'

/** Satu kolom tab campaign. `key` stabil (dipakai untuk aturan akses creator), `label` = header. */
export interface SheetColumn {
  key: string
  label: string
  /** Ada = kolom progress buatan admin (bisa diedit); kosong = kolom sistem/jawaban form (read-only). */
  progress?: IProgressColumn
}

/** Kolom tab campaign: dasar + PIC/Partner + jawaban custom (AD-50) + Handle By/Email + kolom
 * progress. Kolom baru sengaja ditaruh di belakang supaya kolom lama di Google Sheet tidak bergeser.
 * Dipakai bareng sync ke Sheet, tabel Master admin, dan portal creator — isinya identik. */
export function campaignSheetColumns(campaign: ICampaign): SheetColumn[] {
  return [
    ...CAMPAIGN_HEADERS_BASE.map((h) => ({ key: h, label: h })),
    { key: 'PIC/Partner', label: 'PIC/Partner' },
    ...(campaign.customFields || []).map((f) => ({ key: `custom:${f.id}`, label: f.label })),
    { key: 'Handle By', label: 'Handle By' },
    { key: 'Email', label: 'Email' },
    ...(campaign.progressColumns || []).map((c) => ({ key: `progress:${c.id}`, label: c.label, progress: c })),
  ]
}

export function campaignSheetHeaders(campaign: ICampaign): string[] {
  return campaignSheetColumns(campaign).map((c) => c.label)
}

const NUMBER_FIELDS = new Set<SubmissionField>(['views', 'likes', 'comments', 'shares', 'saves', 'reach'])

/** Tipe input sel — kolom yang diikat ke Submission tipenya mengikuti field-nya, bukan pilihan admin. */
export function progressKind(col: IProgressColumn): CellKind {
  const field = col.submission?.field
  if (!field) return col.type
  if (field === 'link') return 'link'
  if (field === 'postedAt') return 'date'
  if (field === 'screenshots') return 'file'
  return 'number'
}

/** Submission yang "dimiliki" kolom progress ini: terbaru untuk tipe+platform tsb. `submissions` harus urut terbaru dulu. */
export function boundSubmission(col: IProgressColumn, submissions: ISubmission[]): ISubmission | undefined {
  const b = col.submission
  return b ? submissions.find((s) => s.type === b.type && s.platform === b.platform) : undefined
}

export function progressCell(col: IProgressColumn, application: IApplication, submissions: ISubmission[]): string | number {
  const field = col.submission?.field
  if (!field) return application.progress?.[col.id] ?? ''
  const sub = boundSubmission(col, submissions)
  if (!sub) return ''
  if (field === 'link') return sub.link || ''
  if (field === 'postedAt') return fmtDateISO(sub.postedAt)
  if (field === 'screenshots') return (sub.insightScreenshotUrls || []).join(' ')
  return NUMBER_FIELDS.has(field) ? sub.parsedInsight?.[field as 'views'] ?? '' : ''
}

// Kolom yang boleh dilihat creator lain secara default — sisanya (WA, email, kurasi, jawaban
// form, dll) tersembunyi sampai admin membukanya, supaya data pribadi tidak bocor antar creator.
const DEFAULT_VIEW_COLUMNS = new Set(['Creator', 'Status Aplikasi', 'PIC/Partner', 'Handle By'])

export function creatorAccess(campaign: ICampaign, col: SheetColumn): CreatorAccess {
  if (col.progress) return col.progress.creatorAccess
  const set = campaign.columnAccess?.get?.(col.key)
  if (set) return set === 'edit' ? 'view' : set
  return DEFAULT_VIEW_COLUMNS.has(col.key) ? 'view' : 'hidden'
}

export function campaignSheetRow(
  campaign: ICampaign,
  application: IApplication,
  creator: Pick<ICreator, 'name' | 'phone' | 'email'> | null,
  /** Semua submission creator ini di campaign ini, urut terbaru dulu */
  submissions: ISubmission[],
  picName: string | undefined
): (string | number)[] {
  const latestSubmission = submissions[0]
  return [
    creator?.name || '',
    creator?.phone || '',
    application.status,
    application.curationResult,
    application.creatorPaymentStatus,
    fmtDateISO(application.createdAt),
    latestSubmission?.type || '',
    latestSubmission?.platform || '',
    latestSubmission?.link || '',
    latestSubmission?.status || '',
    latestSubmission?.parsedInsight?.views ?? '',
    latestSubmission?.parsedInsight?.likes ?? '',
    latestSubmission?.parsedInsight?.comments ?? '',
    latestSubmission?.parsedInsight?.shares ?? '',
    latestSubmission ? fmtDateISO(latestSubmission.createdAt) : '',
    picName || '',
    ...(campaign.customFields || []).map((f) => formatCustomAnswer(application.customAnswers?.[f.id])),
    application.handleBy || '',
    creator?.email || '',
    ...(campaign.progressColumns || []).map((c) => progressCell(c, application, submissions)),
  ]
}

async function syncCampaignRow(tenantId: Types.ObjectId, campaignId: Types.ObjectId, creatorId: Types.ObjectId): Promise<void> {
  const application = await Application.findOne({ tenantId, campaignId, creatorId })
  if (!application) return
  const [campaign, creator, submissions, picUser] = await Promise.all([
    Campaign.findById(campaignId),
    Creator.findById(creatorId),
    Submission.find({ tenantId, campaignId, creatorId }).sort({ createdAt: -1 }),
    application.picUserId ? PicUser.findById(application.picUserId).select('name') : null,
  ])
  if (!campaign) return

  await upsertCampaignRow(
    campaign.name,
    String(application._id),
    campaignSheetRow(campaign, application, creator, submissions, picUser?.name),
    campaignSheetHeaders(campaign)
  )
}

export function syncApplicationToSheet(application: IApplication): Promise<void> {
  return syncCampaignRow(application.tenantId, application.campaignId, application.creatorId)
}

export function syncSubmissionToSheet(submission: ISubmission): Promise<void> {
  return syncCampaignRow(submission.tenantId, submission.campaignId, submission.creatorId)
}
