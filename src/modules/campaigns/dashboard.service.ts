import { ICampaign } from './campaign.model'
import Application from '../applications/application.model'
import Submission from '../submissions/submission.model'
import CreatorHistory from '../creators/creatorHistory.model'

/**
 * Data read-only dashboard PIC/Handle-by (AD-48). Dipakai dua jalur akses:
 * kode akses publik (publicCampaign.routes.ts, SELALU tanpa filterPicUserId — sengaja
 * unfiltered, "seluruh data campaign" sesuai keputusan 28 Agu di 09-open-questions.md)
 * dan akun PIC login (pic.routes.ts, mengirim filterPicUserId = akun PIC yang login,
 * supaya cuma lihat creator yang di-assign ke dia — lihat Application.picUserId).
 */
export async function getCampaignDashboardData(campaign: ICampaign, filterPicUserId?: string) {
  const applicationFilter: Record<string, unknown> = { tenantId: campaign.tenantId, campaignId: campaign._id }
  if (filterPicUserId) applicationFilter.picUserId = filterPicUserId

  const applications = await Application.find(applicationFilter)
    .populate('creatorId', 'name phone domicile socials niches performanceScore')
    .sort({ createdAt: -1 })

  // Kalau di-filter per PIC, submission & histori-nya ikut disempitkan ke creator yang sama
  // (Application yang lolos filter) — biar dashboard-nya konsisten, bukan cuma daftar pendaftar
  // yang kefilter tapi progres/riwayatnya tetap nampilin creator orang lain.
  const submissionFilter: Record<string, unknown> = { tenantId: campaign.tenantId, campaignId: campaign._id }
  const historyFilter: Record<string, unknown> = { tenantId: campaign.tenantId, campaignId: campaign._id }
  if (filterPicUserId) {
    const creatorIds = applications.map((a) => a.creatorId)
    submissionFilter.creatorId = { $in: creatorIds }
    historyFilter.creatorId = { $in: creatorIds }
  }

  const [submissions, histories] = await Promise.all([
    Submission.find(submissionFilter).sort({ createdAt: -1 }),
    CreatorHistory.find(historyFilter).sort({ createdAt: -1 }),
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
