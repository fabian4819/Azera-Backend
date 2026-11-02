import { Types } from 'mongoose'
import Campaign from './campaign.model'
import WorkflowAudit from './workflowAudit.model'
import Application from '../applications/application.model'
import Submission from '../submissions/submission.model'
import PicUser from '../pic/pic.model'
import CreatorHistory from '../creators/creatorHistory.model'
import WorkflowStageLog from '../workflow/workflowStage.model'
import FinanceRecord from '../finance/financeRecord.model'
import Invoice from '../finance/invoice.model'
import Document from '../documents/document.model'
import Asset from '../assets/asset.model'
import WaMessageLog from '../whatsapp/waMessageLog.model'
import ExtensionCaptureIntent from '../extension/captureIntent.model'

/** Hapus campaign beserta semua data yang menempel (termasuk invoice & keuangan, keputusan owner).
 * Creator, brand & akun PIC tetap; PIC cuma dilepas dari campaign ini. Spreadsheet/folder Google
 * Drive campaign tidak ikut dihapus (hapus manual di Shared Drive kalau perlu).
 * ponytail: tanpa transaksi Mongo; gagal di tengah = sebagian data terhapus, ulangi hapus untuk menuntaskan. */
export async function deleteCampaigns(tenantId: Types.ObjectId | string, ids: string[]): Promise<string[]> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id))
  const campaigns = await Campaign.find({ tenantId, _id: { $in: valid } }).select('_id name')
  const campaignIds = campaigns.map((c) => c._id)
  if (!campaignIds.length) return []
  const byCampaign = { campaignId: { $in: campaignIds } }
  await Promise.all([
    Application.deleteMany(byCampaign),
    Submission.deleteMany(byCampaign),
    WorkflowAudit.deleteMany(byCampaign),
    WorkflowStageLog.deleteMany(byCampaign),
    CreatorHistory.deleteMany(byCampaign),
    FinanceRecord.deleteMany(byCampaign),
    Invoice.deleteMany(byCampaign),
    Document.deleteMany(byCampaign),
    Asset.deleteMany(byCampaign),
    WaMessageLog.deleteMany(byCampaign),
    ExtensionCaptureIntent.deleteMany(byCampaign),
    PicUser.updateMany({ tenantId }, { $pull: { campaignIds: { $in: campaignIds }, paidCampaignIds: { $in: campaignIds } } }),
  ])
  await Campaign.deleteMany({ tenantId, _id: { $in: campaignIds } })
  return campaigns.map((c) => c.name)
}
