import { Types } from 'mongoose'
import { UserRole } from '../users/user.model'
import Campaign, { WorkflowStage, WORKFLOW_STAGES } from './campaign.model'
import WorkflowAudit from './workflowAudit.model'
import Application, { IApplication } from '../applications/application.model'
import Submission from '../submissions/submission.model'

/**
 * AD-32: graf transisi valid — linear 1..17, dengan 2 pengecualian kondisional
 * (docs/plan/modul-4-automation-workflow.md):
 * - creator_approved(6) bisa lompat ke brief_sent(8) langsung (client_approval di-skip per campaign)
 * - content_review(10) bisa ke revision(11) yang loop balik ke content_review(10)
 */
export const WORKFLOW_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  draft: ['listing'],
  listing: ['open_registration'],
  open_registration: ['internal_review'],
  internal_review: ['smart_recommendation'],
  smart_recommendation: ['creator_approved'],
  creator_approved: ['client_approval', 'brief_sent'],
  client_approval: ['brief_sent'],
  brief_sent: ['waiting_draft'],
  waiting_draft: ['content_review'],
  content_review: ['revision', 'waiting_post'],
  revision: ['content_review'],
  waiting_post: ['posted'],
  posted: ['waiting_insight'],
  waiting_insight: ['insight_collected'],
  insight_collected: ['report_generated'],
  report_generated: ['completed'],
  completed: [],
}

/** Role yang boleh melakukan transisi tertentu — key: "from->to". Tidak ada entry = owner/admin saja. */
const TRANSITION_ROLES: Record<string, UserRole[]> = {
  'draft->listing': ['owner', 'admin', 'ce'],
  'listing->open_registration': ['owner', 'admin'],
  'open_registration->internal_review': ['owner', 'admin', 'ce'],
  'internal_review->smart_recommendation': ['owner', 'admin', 'ce'], // biasanya otomatis, tapi boleh dipicu manual
  'smart_recommendation->creator_approved': ['owner', 'admin', 'ce'],
  'creator_approved->client_approval': ['owner', 'admin'],
  'creator_approved->brief_sent': ['owner', 'admin'],
  'client_approval->brief_sent': ['owner', 'admin'],
  'brief_sent->waiting_draft': ['owner', 'admin', 'ce'],
  'waiting_draft->content_review': ['owner', 'admin', 'ce'],
  'content_review->revision': ['owner', 'admin', 'ce'],
  'content_review->waiting_post': ['owner', 'admin', 'ce'],
  'revision->content_review': ['owner', 'admin', 'ce'],
  'waiting_post->posted': ['owner', 'admin', 'ce'],
  'posted->waiting_insight': ['owner', 'admin', 'ce'],
  'waiting_insight->insight_collected': ['owner', 'admin', 'ce'],
  'insight_collected->report_generated': ['owner', 'admin'],
  'report_generated->completed': ['owner', 'admin'],
}

export class WorkflowTransitionError extends Error {}

/**
 * AD-32: eksekusi transisi tahap dengan guard (transisi valid + role), dicatat ke
 * WorkflowAudit. Owner (atau admin dengan `reason`) bisa override ke tahap manapun.
 */
export async function transitionWorkflow(opts: {
  campaignId: string
  tenantId: string
  toStage: WorkflowStage
  userId: string
  role: UserRole
  reason?: string
  override?: boolean
}) {
  const campaign = await Campaign.findOne({ _id: opts.campaignId, tenantId: opts.tenantId })
  if (!campaign) throw new WorkflowTransitionError('Campaign tidak ditemukan')
  if (!WORKFLOW_STAGES.includes(opts.toStage)) throw new WorkflowTransitionError('Tahap tidak dikenal')

  const fromStage = campaign.workflowStage
  const isOverride = !!opts.override
  const key = `${fromStage}->${opts.toStage}`
  const validPath = WORKFLOW_TRANSITIONS[fromStage]?.includes(opts.toStage)

  if (!isOverride && !validPath) {
    throw new WorkflowTransitionError(`Transisi ${fromStage} -> ${opts.toStage} tidak valid. Gunakan override kalau ini disengaja.`)
  }
  if (isOverride) {
    // Matrix: "Override tahap mana pun | Owner (dan Admin dengan alasan)" — role lain tidak boleh override sama sekali.
    if (opts.role !== 'owner' && opts.role !== 'admin') {
      throw new WorkflowTransitionError('Cuma Owner atau Admin yang boleh override tahap')
    }
    if (opts.role !== 'owner' && !opts.reason) {
      throw new WorkflowTransitionError('Override butuh alasan kalau bukan Owner')
    }
  }
  if (!isOverride) {
    const allowedRoles = TRANSITION_ROLES[key] || ['owner', 'admin']
    if (!allowedRoles.includes(opts.role)) {
      throw new WorkflowTransitionError(`Role ${opts.role} tidak boleh melakukan transisi ini`)
    }
  }

  campaign.workflowStage = opts.toStage
  await campaign.save()

  await WorkflowAudit.create({
    tenantId: opts.tenantId,
    campaignId: campaign._id,
    fromStage,
    toStage: opts.toStage,
    byUserId: opts.userId,
    byRole: opts.role,
    isOverride,
    reason: opts.reason,
  })

  return campaign
}

/** Best-effort auto-transition dipakai sebagai side-effect dari aksi lain — tidak pernah throw. */
export async function tryAutoTransition(opts: {
  campaignId: string
  tenantId: string
  fromStage: WorkflowStage
  toStage: WorkflowStage
  userId: string
}) {
  try {
    const campaign = await Campaign.findOne({ _id: opts.campaignId, tenantId: opts.tenantId })
    if (!campaign || campaign.workflowStage !== opts.fromStage) return
    await transitionWorkflow({
      campaignId: opts.campaignId,
      tenantId: opts.tenantId,
      toStage: opts.toStage,
      userId: opts.userId,
      role: 'admin',
      reason: 'auto',
      override: true,
    })
  } catch {
    // best-effort — jangan ganggu aksi utama
  }
}

export type CreatorSubStage =
  | 'brief_sent' | 'waiting_draft' | 'content_review' | 'revision'
  | 'waiting_post' | 'posted' | 'waiting_insight' | 'insight_collected'

/** AD-32: tahap 8-15 sebenarnya per-creator — dihitung dari Submission, bukan disimpan terpisah */
export function computeCreatorSubStage(submissions: { type: string; status: string; parsedInsight?: { views?: number } }[]): CreatorSubStage {
  const posts = submissions.filter((s) => s.type === 'post')
  const drafts = submissions.filter((s) => s.type === 'draft')

  if (posts.length > 0) {
    const hasInsight = posts.some((s) => s.parsedInsight?.views !== undefined)
    return hasInsight ? 'insight_collected' : 'waiting_insight'
  }
  if (drafts.length > 0) {
    const latest = drafts[drafts.length - 1]
    if (latest.status === 'revision_requested') return 'revision'
    if (latest.status === 'approved') return 'waiting_post'
    return 'content_review'
  }
  return 'waiting_draft'
}

export async function getCreatorSubStages(campaignId: string, tenantId: string) {
  const applications = await Application.find({ tenantId, campaignId, status: 'accepted' }).populate('creatorId', 'name phone') as unknown as (IApplication & { creatorId: { _id: Types.ObjectId; name: string; phone: string } })[]
  const result = []
  for (const app of applications) {
    const submissions = await Submission.find({ tenantId, campaignId, creatorId: app.creatorId._id })
    result.push({
      applicationId: String(app._id),
      creatorName: app.creatorId.name,
      subStage: computeCreatorSubStage(submissions),
    })
  }
  return result
}
