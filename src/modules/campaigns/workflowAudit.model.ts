import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'
/** Histori perpindahan tahap campaign. String bebas: riwayat lama masih memakai nama 17 tahap. */
export interface IWorkflowAudit extends Document {
  tenantId: Types.ObjectId
  campaignId: Types.ObjectId
  fromStage: string
  toStage: string
  byUserId: Types.ObjectId
  byRole: string
  isOverride: boolean
  reason?: string
  createdAt: Date
}

const WorkflowAuditSchema = new Schema<IWorkflowAudit>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
    fromStage: { type: String, required: true },
    toStage: { type: String, required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    byRole: { type: String, required: true },
    isOverride: { type: Boolean, default: false },
    reason: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

withTenant(WorkflowAuditSchema)
WorkflowAuditSchema.index({ tenantId: 1, campaignId: 1, createdAt: -1 })

export default mongoose.model<IWorkflowAudit>('WorkflowAudit', WorkflowAuditSchema)
