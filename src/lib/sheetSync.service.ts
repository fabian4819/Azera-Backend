import { ICreator, SocialPlatform } from '../modules/creators/creator.model'
import { IApplication } from '../modules/applications/application.model'
import { ISubmission } from '../modules/submissions/submission.model'
import Campaign from '../modules/campaigns/campaign.model'
import Creator from '../modules/creators/creator.model'
import Brand from '../models/Brand'
import SocialSnapshot, { ISocialSnapshot } from '../modules/extension/socialSnapshot.model'
import { upsertCreatorRow, upsertApplicationRow, upsertSubmissionRow } from './googleSheets'

const GENDER_LABELS: Record<string, string> = {
  male: 'Laki-laki',
  female_hijab: 'Perempuan (Hijab)',
  female_non_hijab: 'Perempuan (Non-Hijab)',
}

const RATE_NEGO_LABELS: Record<string, string> = { yes: 'Bisa', no: 'Tidak', depends: 'Tergantung campaign' }

// Sama seperti complianceLabels di client/src/pages/admin/Creators.tsx — dipakai juga sebagai opsi
// dropdown Compliance di sheet, jadi labelnya harus sama persis dengan yang admin lihat di dashboard.
const COMPLIANCE_LABELS: Record<string, string> = { ok: 'OK', sp1: 'SP1', sp2_blacklist: 'Blacklist' }
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

const fmtDate = (d?: Date) => (d ? d.toLocaleDateString('id-ID') : '')
// ISO (yyyy-mm-dd) — dipakai khusus kolom Tanggal Daftar tab Creators, yang sync-nya pakai
// valueInputOption USER_ENTERED supaya Sheets parse ini sebagai tipe Date beneran, bukan teks.
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

/** Ringkasan lengkap satu tarikan ekstensi (snapshot terbaru per platform) — semua metrik yang
 * juga ditampilkan di panel "Metrik dari Ekstensi" pada CreatorDetail admin (SnapshotDetail.tsx),
 * dipadatkan jadi satu baris teks per sel. Kosong kalau belum pernah ditarik ekstensinya. */
function formatExtensionMetrics(snap: ISocialSnapshot | undefined): string {
  if (!snap) return ''
  const n = (v?: number | null) => (v != null ? v.toLocaleString('id-ID') : undefined)
  const pct = (v?: number | null) => (v != null ? `${v}%` : undefined)
  const parts: string[] = []
  if (snap.followers != null) parts.push(`${n(snap.followers)} followers`)
  if (snap.following != null) parts.push(`${n(snap.following)} following`)
  if (snap.postsCount != null) parts.push(`${n(snap.postsCount)} post`)
  if (snap.engagementRate != null) {
    parts.push(`ER ${pct(snap.engagementRate)}${snap.engagementRateMedian != null ? ` (median ${pct(snap.engagementRateMedian)})` : ''}`)
  }
  if (snap.engagementRateViews != null) parts.push(`ER by views ${pct(snap.engagementRateViews)}`)
  if (snap.avgLikes != null) parts.push(`avg likes ${n(snap.avgLikes)}${snap.medLikes != null ? ` (median ${n(snap.medLikes)})` : ''}`)
  if (snap.avgComments != null) parts.push(`avg komentar ${n(snap.avgComments)}${snap.medComments != null ? ` (median ${n(snap.medComments)})` : ''}`)
  if (snap.avgViews != null) parts.push(`avg views ${n(snap.avgViews)}${snap.medViews != null ? ` (median ${n(snap.medViews)})` : ''}`)
  if (snap.avgShares != null) parts.push(`avg shares ${n(snap.avgShares)}`)
  if (snap.isVerified) parts.push('Terverifikasi')
  return parts.join(' · ')
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
    formatExtensionMetrics(latestByPlatform.get(p)),
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
    creator.source === 'import' ? 'Import' : 'Form',
    STATUS_LABELS[creator.status] || creator.status,
    fmtDateISO(creator.createdAt),
  ])
}

export async function syncApplicationToSheet(application: IApplication): Promise<void> {
  const campaign = await Campaign.findById(application.campaignId)
  if (!campaign) return
  const [brand, creator] = await Promise.all([
    Brand.findById(campaign.brandId),
    Creator.findById(application.creatorId),
  ])
  await upsertApplicationRow(campaign.name, String(application._id), [
    brand?.namaBrand || '',
    creator?.name || '',
    application.status,
    application.curationResult,
    application.creatorPaymentStatus,
    fmtDate(application.createdAt),
  ])
}

export async function syncSubmissionToSheet(submission: ISubmission): Promise<void> {
  const campaign = await Campaign.findById(submission.campaignId)
  if (!campaign) return
  const creator = await Creator.findById(submission.creatorId)
  await upsertSubmissionRow(campaign.name, String(submission._id), [
    creator?.name || '',
    submission.type,
    submission.platform,
    submission.link || '',
    submission.status,
    submission.parsedInsight?.views ?? '',
    submission.parsedInsight?.likes ?? '',
    submission.parsedInsight?.comments ?? '',
    submission.parsedInsight?.shares ?? '',
    fmtDate(submission.createdAt),
  ])
}
