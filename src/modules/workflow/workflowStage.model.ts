import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'
import { WORKFLOW_STAGES, WorkflowStage } from '../campaigns/campaign.model'

export interface IWorkflowStageLog extends Document {
  tenantId: Types.ObjectId
  campaignId: Types.ObjectId
  creatorId?: Types.ObjectId
  stage: WorkflowStage
  enteredAt: Date
  byUserId?: Types.ObjectId
  note?: string
  isOverride: boolean
}

const WorkflowStageLogSchema = new Schema<IWorkflowStageLog>({
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
  creatorId: { type: Schema.Types.ObjectId, ref: 'Creator' },
  stage: { type: String, enum: WORKFLOW_STAGES, required: true },
  enteredAt: { type: Date, default: Date.now },
  byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  note: String,
  isOverride: { type: Boolean, default: false },
})

withTenant(WorkflowStageLogSchema)
WorkflowStageLogSchema.index({ tenantId: 1, campaignId: 1, enteredAt: -1 })

export default mongoose.model<IWorkflowStageLog>('WorkflowStageLog', WorkflowStageLogSchema)
