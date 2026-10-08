import { effectiveRole } from '../../middleware/auth'
import { UserRole } from '../users/user.model'
import Campaign, { WorkflowStage, WORKFLOW_STAGES, LEGACY_STAGE_MAP } from './campaign.model'
import WorkflowAudit from './workflowAudit.model'
import Tenant from '../tenants/tenant.model'
import { connectDB } from '../../db/connect'

/**
 * Progress campaign (disederhanakan dari 17 tahap, Okt 2026): listing → running → insight → report → completed,
 * plus `rejected` (ditolak) dari listing. Semua perpindahan manual oleh admin, tahap mana pun ke tahap mana pun;
 * progress per creator sekarang dilihat di tabel Master Sheet, bukan dari tahap campaign.
 */
const MOVERS: UserRole[] = ['owner', 'admin']

export class WorkflowTransitionError extends Error {}

/** Pindah tahap campaign (owner/admin), dicatat ke WorkflowAudit. */
export async function transitionWorkflow(opts: {
  campaignId: string
  tenantId: string
  toStage: WorkflowStage
  userId: string
  role: UserRole
  reason?: string
}) {
  if (!WORKFLOW_STAGES.includes(opts.toStage)) throw new WorkflowTransitionError('Tahap tidak dikenal')
  if (!MOVERS.includes(effectiveRole(opts.role))) throw new WorkflowTransitionError('Cuma Owner atau Admin yang boleh memindahkan tahap')

  const campaign = await Campaign.findOne({ _id: opts.campaignId, tenantId: opts.tenantId })
  if (!campaign) throw new WorkflowTransitionError('Campaign tidak ditemukan')
  const fromStage = campaign.workflowStage
  if (fromStage === opts.toStage) return campaign

  campaign.workflowStage = opts.toStage
  await campaign.save()

  await WorkflowAudit.create({
    tenantId: opts.tenantId,
    campaignId: campaign._id,
    fromStage,
    toStage: opts.toStage,
    byUserId: opts.userId,
    byRole: opts.role,
    isOverride: false,
    reason: opts.reason,
  })

  return campaign
}

/** Sekali jalan & idempoten: campaign yang masih memakai nama tahap lama (17 tahap) dipetakan ke tahap baru.
 * Dipanggil saat server production start; riwayat WorkflowAudit lama dibiarkan apa adanya. */
export async function migrateLegacyStages(): Promise<void> {
  await connectDB()
  for (const tenant of await Tenant.find()) {
    for (const [from, to] of Object.entries(LEGACY_STAGE_MAP)) {
      const res = await Campaign.updateMany({ tenantId: tenant._id, workflowStage: from }, { $set: { workflowStage: to } })
      if (res.modifiedCount) console.log(`Workflow migrate [${tenant._id}]: ${from} -> ${to} (${res.modifiedCount} campaign)`)
    }
  }
}
