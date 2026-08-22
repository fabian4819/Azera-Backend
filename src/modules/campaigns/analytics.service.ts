import { Types } from 'mongoose'
import Submission from '../submissions/submission.model'
import Application from '../applications/application.model'
import Campaign from './campaign.model'

export interface CampaignAnalytics {
  totalPosts: number
  totalViews: number
  totalLikes: number
  totalComments: number
  totalShares: number
  /** null kalau tidak ada satupun post di platform yang punya reach (IG/TikTok) — bukan 0 */
  totalReach: number | null
  /** null kalau tidak ada satupun post di platform yang punya saves (IG/TikTok) — bukan 0 */
  totalSaves: number | null
  engagementRate: number
  costPerView: number | null
  cpm: number | null
  targetKpi?: { views?: number; engagementRate?: number }
  achievement?: { viewsPct?: number; engagementRatePct?: number }
  perPlatform: Record<string, { posts: number; views: number; likes: number; comments: number; shares: number }>
}

/**
 * AD-23: agregasi insight per campaign. Reach & saves cuma ada di IG/TikTok
 * (notes klien 17 Agu) — kalau campaign cuma jalan di X/Threads, totalReach
 * dan totalSaves harus null (unknown), bukan 0 (sudah tercapai/tidak ada).
 */
export async function computeCampaignAnalytics(
  campaignId: string | Types.ObjectId,
  tenantId: string | Types.ObjectId
): Promise<CampaignAnalytics> {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId })
  const submissions = await Submission.find({
    tenantId,
    campaignId,
    type: 'post',
    'parsedInsight.views': { $ne: null },
  })

  let totalViews = 0
  let totalLikes = 0
  let totalComments = 0
  let totalShares = 0
  let totalReach = 0
  let totalSaves = 0
  let reachContributors = 0
  let savesContributors = 0
  const perPlatform: CampaignAnalytics['perPlatform'] = {}

  for (const s of submissions) {
    const pi = s.parsedInsight
    if (!pi) continue
    totalViews += pi.views || 0
    totalLikes += pi.likes || 0
    totalComments += pi.comments || 0
    totalShares += pi.shares || 0
    if (pi.reach !== undefined && pi.reach !== null) {
      totalReach += pi.reach
      reachContributors++
    }
    if (pi.saves !== undefined && pi.saves !== null) {
      totalSaves += pi.saves
      savesContributors++
    }

    if (!perPlatform[s.platform]) perPlatform[s.platform] = { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 }
    perPlatform[s.platform].posts++
    perPlatform[s.platform].views += pi.views || 0
    perPlatform[s.platform].likes += pi.likes || 0
    perPlatform[s.platform].comments += pi.comments || 0
    perPlatform[s.platform].shares += pi.shares || 0
  }

  const totalEngagement = totalLikes + totalComments + totalShares + totalSaves
  const engagementRate = totalViews > 0 ? Math.round((totalEngagement / totalViews) * 10000) / 100 : 0

  const budget = campaign?.budget
  const costPerView = budget && totalViews > 0 ? Math.round((budget / totalViews) * 100) / 100 : null
  const cpm = budget && totalViews > 0 ? Math.round((budget / totalViews) * 1000) : null

  const targetKpi = campaign?.targetKpi
  const achievement: CampaignAnalytics['achievement'] = {}
  if (targetKpi?.views) achievement.viewsPct = Math.round((totalViews / targetKpi.views) * 10000) / 100
  if (targetKpi?.engagementRate) achievement.engagementRatePct = Math.round((engagementRate / targetKpi.engagementRate) * 10000) / 100

  return {
    totalPosts: submissions.length,
    totalViews, totalLikes, totalComments, totalShares,
    totalReach: reachContributors > 0 ? totalReach : null,
    totalSaves: savesContributors > 0 ? totalSaves : null,
    engagementRate, costPerView, cpm,
    targetKpi,
    achievement,
    perPlatform,
  }
}

export interface CreatorSummary {
  name: string
  platform: string
  views: number
  engagement: number
  costPerView: number | null
}

/** Ringkasan performa per creator accepted di campaign — dipakai AD-24 (insight) & AD-26 (report) */
export async function getCampaignCreatorSummaries(
  campaignId: string | Types.ObjectId,
  tenantId: string | Types.ObjectId
): Promise<CreatorSummary[]> {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId })
  const acceptedApplications = await Application.find({ tenantId, campaignId, status: 'accepted' }).populate('creatorId', 'name')

  return Promise.all(
    acceptedApplications.map(async (app) => {
      const subs = await Submission.find({ tenantId, campaignId, creatorId: app.creatorId, type: 'post' })
      const views = subs.reduce((sum, s) => sum + (s.parsedInsight?.views || 0), 0)
      const engagement = subs.reduce(
        (sum, s) => sum + (s.parsedInsight?.likes || 0) + (s.parsedInsight?.comments || 0) + (s.parsedInsight?.shares || 0) + (s.parsedInsight?.saves || 0),
        0
      )
      const fee = campaign?.fee.creatorFee || 0
      const costPerView = fee && views > 0 ? Math.round((fee / views) * 100) / 100 : null
      return {
        name: (app.creatorId as unknown as { name: string })?.name || '-',
        platform: subs[0]?.platform || '-',
        views, engagement, costPerView,
      }
    })
  )
}
