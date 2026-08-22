import { Types } from 'mongoose'
import { generateText } from '../../lib/ai'
import { computeCampaignAnalytics } from '../campaigns/analytics.service'
import Campaign from '../campaigns/campaign.model'
import Brand from '../../models/Brand'
import DocumentModel from './document.model'

/**
 * AD-27: Auto Case Study Generator — model "content website" saja (model
 * autofill IG di-drop, keputusan klien 16 Agu). Hasilnya struktur data untuk
 * dirender sebagai halaman web (Portfolio, integrasi AD-10 minggu 5) yang
 * screenshot-friendly, bukan PDF.
 */
export async function generateCaseStudy(campaignId: string | Types.ObjectId, tenantId: string | Types.ObjectId) {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId })
  if (!campaign) throw new Error('Campaign not found')
  const brand = await Brand.findById(campaign.brandId)
  const analytics = await computeCampaignAnalytics(campaignId, tenantId)

  const prompt = `Buat case study campaign influencer marketing berikut untuk ditampilkan di halaman portfolio agency KOL. Tulis dalam Bahasa Indonesia, gaya persuasif untuk calon client baru.

Brand: ${brand?.namaBrand || '-'}
Campaign: ${campaign.name}
Tujuan: ${campaign.objective}
Hasil: ${analytics.totalViews.toLocaleString('id-ID')} views, engagement rate ${analytics.engagementRate}%, ${analytics.totalPosts} post dari creator terkurasi.
${campaign.aiInsight ? `Insight tambahan: ${campaign.aiInsight}` : ''}

Kembalikan HANYA JSON (tanpa markdown code block):
{"headline": "judul case study yang menarik, maks 10 kata", "challenge": "tantangan brand sebelum campaign, 2-3 kalimat", "approach": "strategi/pendekatan Azera, 2-3 kalimat", "results": "hasil campaign, 2-3 kalimat dengan angka konkret"}`

  const raw = await generateText(prompt, 'Kamu adalah copywriter yang menulis case study marketing untuk agency KOL Indonesia.')
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(cleaned) as { headline: string; challenge: string; approach: string; results: string }

  const document = await DocumentModel.create({
    tenantId,
    type: 'case_study',
    campaignId: campaign._id,
    brandId: campaign.brandId,
    data: {
      headline: parsed.headline,
      challenge: parsed.challenge,
      approach: parsed.approach,
      results: parsed.results,
      brandName: brand?.namaBrand,
      campaignName: campaign.name,
      highlightStats: {
        views: analytics.totalViews,
        engagementRate: analytics.engagementRate,
        totalPosts: analytics.totalPosts,
        reach: analytics.totalReach,
      },
    },
  })

  return document
}
