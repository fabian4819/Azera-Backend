import { ICreator, SocialPlatform } from '../modules/creators/creator.model'
import { IApplication } from '../modules/applications/application.model'
import { ISubmission } from '../modules/submissions/submission.model'
import Campaign from '../modules/campaigns/campaign.model'
import Creator from '../modules/creators/creator.model'
import Brand from '../models/Brand'
import SocialSnapshot from '../modules/extension/socialSnapshot.model'
import { upsertCreatorRow, upsertApplicationRow, upsertSubmissionRow } from './googleSheets'

const GENDER_LABELS: Record<string, string> = {
  male: 'Laki-laki',
  female_hijab: 'Perempuan (Hijab)',
  female_non_hijab: 'Perempuan (Non-Hijab)',
}

const RATE_NEGO_LABELS: Record<string, string> = { yes: 'Bisa', no: 'Tidak', depends: 'Tergantung campaign' }

const fmtDate = (d?: Date) => (d ? d.toLocaleDateString('id-ID') : '')

const CREATOR_PLATFORMS: SocialPlatform[] = ['instagram', 'tiktok', 'threads', 'x']

/** "@username · 12.000 followers · ER 3.2% · avg 1.500 views" — ER/avg views cuma muncul
 * kalau ada data ekstensi (SocialSnapshot) yang match; kalau belum pernah ditarik, cuma
 * username+followers dari isian creator sendiri. Kosong kalau platform ini tidak diisi. */
function formatPlatformCell(
  social: { username: string; followers: number } | undefined,
  snapshot: { followers?: number; engagementRate?: number; avgViews?: number } | undefined
): string {
  if (!social && !snapshot) return ''
  const parts: string[] = []
  if (social) parts.push(`@${social.username}`)
  const followers = snapshot?.followers ?? social?.followers
  if (followers != null) parts.push(`${followers.toLocaleString('id-ID')} followers`)
  if (snapshot?.engagementRate != null) parts.push(`ER ${snapshot.engagementRate}%`)
  if (snapshot?.avgViews != null) parts.push(`avg ${snapshot.avgViews.toLocaleString('id-ID')} views`)
  return parts.join(' · ')
}

function rateSummary(c: Pick<ICreator, 'rateEstimateType' | 'rateEstimateAmount'>): string {
  if (c.rateEstimateType === 'nominal' && c.rateEstimateAmount) return `Rp ${c.rateEstimateAmount.toLocaleString('id-ID')}`
  if (c.rateEstimateType === 'unknown') return 'Belum ada patokan'
  return ''
}

export async function syncCreatorToSheet(creator: ICreator): Promise<void> {
  // Snapshot ekstensi terbaru per platform (kalau pernah ditarik) — 1 query, dikelompokkan di memori
  // karena cuma 4 platform per creator, bukan pantas untuk 4 query terpisah.
  const snapshots = await SocialSnapshot.find({ tenantId: creator.tenantId, creatorId: creator._id }).sort({ createdAt: -1 })
  const latestByPlatform = new Map<SocialPlatform, (typeof snapshots)[number]>()
  for (const snap of snapshots) {
    const p = snap.platform as SocialPlatform
    if (!latestByPlatform.has(p)) latestByPlatform.set(p, snap) // sudah sort createdAt desc → yang pertama = terbaru
  }

  const platformCells = CREATOR_PLATFORMS.map((p) =>
    formatPlatformCell(creator.socials?.find((s) => s.platform === p), latestByPlatform.get(p))
  )

  await upsertCreatorRow(String(creator._id), [
    creator.name,
    creator.phone,
    creator.email || '',
    creator.age ?? '',
    creator.gender ? GENDER_LABELS[creator.gender] : '',
    creator.domicile?.city || '',
    creator.domicile?.province || '',
    creator.niches?.join(', ') || '',
    creator.nicheOther || '',
    creator.contentStyles?.join(', ') || '',
    creator.contentStyleOther || '',
    creator.activities?.join(', ') || '',
    ...platformCells,
    rateSummary(creator),
    creator.rateNegotiable ? RATE_NEGO_LABELS[creator.rateNegotiable] : '',
    creator.bankAccount?.bankName || '',
    creator.bankAccount?.accountNumber || '',
    creator.bankAccount?.accountName || '',
    creator.npwp || '',
    creator.mediaKitUrl || '',
    creator.portfolioLink || '',
    creator.photoUrl || '',
    creator.performanceScore?.reliability ?? '',
    creator.performanceScore?.performance ?? '',
    creator.performanceScore?.communication ?? '',
    creator.performanceScore?.quality ?? '',
    creator.performanceScore?.overall ?? '',
    creator.cancelCount ?? 0,
    creator.complianceStatus,
    fmtDate(creator.sp1Until),
    creator.source === 'import' ? 'Import' : 'Form',
    creator.status,
    fmtDate(creator.createdAt),
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
