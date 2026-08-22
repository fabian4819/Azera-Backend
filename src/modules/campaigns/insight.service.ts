import { Types } from 'mongoose'
import { generateText } from '../../lib/ai'
import { computeCampaignAnalytics, getCampaignCreatorSummaries } from './analytics.service'
import Campaign from './campaign.model'

/**
 * AD-24: setelah campaign selesai, AI analisis pencapaian target, platform
 * terbaik, creator paling efisien biaya, dan rekomendasi campaign berikutnya
 * (proposal hal. 8). Hasilnya disimpan di Campaign.aiInsight, jadi input untuk
 * Auto Report (AD-26).
 */
export async function generateCampaignInsight(
  campaignId: string | Types.ObjectId,
  tenantId: string | Types.ObjectId
): Promise<string> {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId })
  if (!campaign) throw new Error('Campaign not found')

  const analytics = await computeCampaignAnalytics(campaignId, tenantId)
  const creatorStats = await getCampaignCreatorSummaries(campaignId, tenantId)

  const prompt = `Analisis performa campaign influencer marketing berikut dan buatkan insight untuk agency KOL.

Campaign: ${campaign.name}
Budget: Rp${campaign.budget.toLocaleString('id-ID')}
Target KPI: ${campaign.targetKpi?.views ? `${campaign.targetKpi.views.toLocaleString('id-ID')} views` : 'tidak ditentukan'}${campaign.targetKpi?.engagementRate ? `, ER ${campaign.targetKpi.engagementRate}%` : ''}

Hasil Agregat:
- Total post: ${analytics.totalPosts}
- Total views: ${analytics.totalViews.toLocaleString('id-ID')}
- Total reach: ${analytics.totalReach !== null ? analytics.totalReach.toLocaleString('id-ID') : 'tidak tersedia (platform tanpa reach)'}
- Engagement rate: ${analytics.engagementRate}%
- Cost per view: ${analytics.costPerView !== null ? `Rp${analytics.costPerView}` : '-'}
- Pencapaian target views: ${analytics.achievement?.viewsPct !== undefined ? `${analytics.achievement.viewsPct}%` : 'tidak ada target'}

Performa per platform:
${Object.entries(analytics.perPlatform).map(([p, s]) => `- ${p}: ${s.posts} post, ${s.views.toLocaleString('id-ID')} views, ${s.likes + s.comments + s.shares} engagement`).join('\n') || '(belum ada data)'}

Performa per creator (fee per creator: Rp${(campaign.fee.creatorFee || 0).toLocaleString('id-ID')}):
${creatorStats.map((c) => `- ${c.name}: ${c.views.toLocaleString('id-ID')} views, ${c.engagement} engagement${c.costPerView !== null ? `, cost per view Rp${c.costPerView}` : ''}`).join('\n') || '(belum ada creator)'}

Tulis dalam Bahasa Indonesia, singkat dan actionable (maks 300 kata), mencakup:
1. Pencapaian target (kalau ada target)
2. Platform mana yang paling efektif dan kenapa
3. Creator mana yang paling efisien biaya (views/engagement tertinggi per rupiah)
4. Rekomendasi konkret untuk campaign berikutnya`

  const insight = await generateText(prompt, 'Kamu adalah analis performa campaign influencer marketing untuk agency KOL Indonesia.')

  campaign.aiInsight = insight
  await campaign.save()

  return insight
}
