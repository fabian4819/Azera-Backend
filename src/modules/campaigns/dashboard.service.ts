import { ICampaign } from './campaign.model'
import Application from '../applications/application.model'
import Submission from '../submissions/submission.model'
import CreatorHistory from '../creators/creatorHistory.model'

/**
 * Data read-only dashboard PIC/Handle-by (AD-48). Dipakai dua jalur akses:
 * kode akses publik (publicCampaign.routes.ts) dan akun PIC login (pic.routes.ts).
 */
export async function getCampaignDashboardData(campaign: ICampaign) {
  const [applications, submissions, histories] = await Promise.all([
    Application.find({ tenantId: campaign.tenantId, campaignId: campaign._id })
      .populate('creatorId', 'name phone domicile socials niches performanceScore')
      .sort({ createdAt: -1 }),
    Submission.find({ tenantId: campaign.tenantId, campaignId: campaign._id }).sort({ createdAt: -1 }),
    CreatorHistory.find({ tenantId: campaign.tenantId, campaignId: campaign._id }).sort({ createdAt: -1 }),
  ])

  return {
    campaign: {
      name: campaign.name,
      brand: campaign.brandId,
      workflowStage: campaign.workflowStage,
      status: campaign.status,
      budget: campaign.budget,
      timeline: campaign.timeline,
    },
    applications,
    submissions,
    histories,
  }
}
