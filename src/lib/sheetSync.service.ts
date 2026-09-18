import { Types } from 'mongoose'
import { ICreator, SocialPlatform } from '../modules/creators/creator.model'
import { IApplication } from '../modules/applications/application.model'
import Application from '../modules/applications/application.model'
import { ISubmission } from '../modules/submissions/submission.model'
import Submission from '../modules/submissions/submission.model'
import Campaign from '../modules/campaigns/campaign.model'
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
    creator.source === 'import' ? 'Import' : 'Form',
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

async function syncCampaignRow(tenantId: Types.ObjectId, campaignId: Types.ObjectId, creatorId: Types.ObjectId): Promise<void> {
  const application = await Application.findOne({ tenantId, campaignId, creatorId })
  if (!application) return
  const [campaign, creator, latestSubmission, picUser] = await Promise.all([
    Campaign.findById(campaignId),
    Creator.findById(creatorId),
    Submission.findOne({ tenantId, campaignId, creatorId }).sort({ createdAt: -1 }),
    application.picUserId ? PicUser.findById(application.picUserId).select('name') : null,
  ])
  if (!campaign) return

  // AD-50: kolom PIC/Partner + kolom per Campaign.customFields ditambah di belakang kolom dasar —
  // beda-beda per campaign (customFields campaign lain isinya beda), makanya headers dibangun
  // di sini, bukan konstanta tetap seperti CAMPAIGN_HEADERS_BASE.
  const customFields = campaign.customFields || []
  const headers = [...CAMPAIGN_HEADERS_BASE, 'PIC/Partner', ...customFields.map((f) => f.label)]

  await upsertCampaignRow(campaign.name, String(application._id), [
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
    picUser?.name || '',
    ...customFields.map((f) => formatCustomAnswer(application.customAnswers?.[f.id])),
  ], headers)
}

export function syncApplicationToSheet(application: IApplication): Promise<void> {
  return syncCampaignRow(application.tenantId, application.campaignId, application.creatorId)
}

export function syncSubmissionToSheet(submission: ISubmission): Promise<void> {
  return syncCampaignRow(submission.tenantId, submission.campaignId, submission.creatorId)
}
