import { Types } from 'mongoose'
import Creator from './creator.model'
import SocialSnapshot from '../extension/socialSnapshot.model'

/**
 * Performance Score dari metrik sosial (bukan lagi riwayat delivery/CreatorHistory) —
 * dari permintaan klien: nilai dari engagement (like, view, dst), bukan angka netral
 * flat. Sumber data: snapshot terbaru per platform dari ekstensi KOL Lister (SocialSnapshot).
 */

export interface ScoreBreakdown {
  engagement: { score: number; avgEngagementRate: number | null; platforms: number }
  reach: { score: number; totalFollowers: number }
  overall: number
}

export async function computePerformanceScore(
  creatorId: string | Types.ObjectId,
  tenantId: string | Types.ObjectId
): Promise<ScoreBreakdown> {
  const creator = await Creator.findById(creatorId)
  const usernames = [...new Set((creator?.socials || []).map((s) => s.username.toLowerCase()))]

  const latest = usernames.length === 0 ? [] : await SocialSnapshot.aggregate([
    { $match: { tenantId: new Types.ObjectId(tenantId), username: { $in: usernames } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: { platform: '$platform', username: '$username' }, engagementRate: { $first: '$engagementRate' }, followers: { $first: '$followers' } } },
  ]) as { engagementRate?: number; followers?: number }[]

  const ers = latest.map((s) => s.engagementRate).filter((v): v is number => typeof v === 'number')
  const avgEngagementRate = ers.length ? ers.reduce((a, b) => a + b, 0) / ers.length : null
  // ponytail: skala kasar ER% -> skor 0-100 (ER 10%+ dianggap maksimal), kalibrasi ulang kalau distribusi data riil beda
  const engagementScore = avgEngagementRate === null ? 0 : Math.max(0, Math.min(100, avgEngagementRate * 10))

  const snapshotFollowers = latest.reduce((sum, s) => sum + (s.followers || 0), 0)
  const totalFollowers = snapshotFollowers || (creator?.socials || []).reduce((sum, s) => sum + (s.followers || 0), 0)
  // ponytail: skala log followers -> skor 0-100 (100rb followers = 100)
  const reachScore = totalFollowers > 0 ? Math.max(0, Math.min(100, Math.log10(totalFollowers + 1) * 20)) : 0

  const overall = Math.round(engagementScore * 0.6 + reachScore * 0.4)

  const breakdown: ScoreBreakdown = {
    engagement: { score: Math.round(engagementScore), avgEngagementRate, platforms: latest.length },
    reach: { score: Math.round(reachScore), totalFollowers },
    overall,
  }

  await Creator.findByIdAndUpdate(creatorId, {
    performanceScore: {
      engagement: breakdown.engagement.score,
      reach: breakdown.reach.score,
      overall: breakdown.overall,
      updatedAt: new Date(),
    },
  })

  return breakdown
}

export function curationLabel(score: number): 'highly_recommended' | 'recommended' | 'need_review' {
  if (score >= 70) return 'highly_recommended'
  if (score >= 40) return 'recommended'
  return 'need_review'
}

/** Top creator untuk Dashboard Owner: dihitung langsung dari snapshot terbaru (bukan
 * Creator.performanceScore yang di-cache, baru ke-refresh kalau detail creator-nya dibuka),
 * dan dikembalikan sebagai parameter mentah (ER%, followers) — bukan satu angka skor. */
export async function getTopCreatorsByEngagement(tenantId: string | Types.ObjectId, limit = 5) {
  const creators = await Creator.find({ tenantId }, { name: 1, socials: 1 })
  const usernames = [...new Set(creators.flatMap((c) => c.socials.map((s) => s.username.toLowerCase())))]

  const latest = usernames.length === 0 ? [] : await SocialSnapshot.aggregate([
    { $match: { tenantId: new Types.ObjectId(tenantId), username: { $in: usernames } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$username', engagementRate: { $first: '$engagementRate' }, followers: { $first: '$followers' } } },
  ]) as { _id: string; engagementRate?: number; followers?: number }[]
  const byUsername = new Map(latest.map((s) => [s._id, s]))

  return creators
    .map((c) => {
      const snaps = c.socials.map((s) => byUsername.get(s.username.toLowerCase())).filter(Boolean) as { engagementRate?: number; followers?: number }[]
      const ers = snaps.map((s) => s.engagementRate).filter((v): v is number => typeof v === 'number')
      const avgEngagementRate = ers.length ? ers.reduce((a, b) => a + b, 0) / ers.length : null
      const totalFollowers = snaps.reduce((sum, s) => sum + (s.followers || 0), 0)
      return { id: String(c._id), name: c.name, avgEngagementRate, totalFollowers }
    })
    .filter((r) => r.avgEngagementRate !== null)
    .sort((a, b) => (b.avgEngagementRate || 0) - (a.avgEngagementRate || 0))
    .slice(0, limit)
}
