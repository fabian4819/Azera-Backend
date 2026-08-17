import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/**
 * Trigger untuk creator dan client — docs/plan/modul-4-automation-workflow.md
 */
export const WA_TRIGGERS = [
  // creator
  'creator_accepted',
  'creator_rejected',
  'brief_campaign',
  'reminder_draft',
  'reminder_upload',
  'reminder_revision',
  'reminder_insight',
  'reminder_payment_creator',
  'payment_completed',
  // client
  'invoice_new',
  'reminder_payment_client',
  'campaign_started',
  'campaign_completed',
  'daily_progress_report',
  'broadcast_campaign',
] as const

export type WaTrigger = (typeof WA_TRIGGERS)[number]
export type WaAudience = 'creator' | 'client'

export interface IWaTemplate extends Document {
  tenantId: Types.ObjectId
  trigger: WaTrigger
  audience: WaAudience
  /** Body dengan placeholder {{nama}}, {{campaign}}, {{deadline}}, dst */
  body: string
  editable: boolean
  createdAt: Date
  updatedAt: Date
}

const WaTemplateSchema = new Schema<IWaTemplate>(
  {
    trigger: { type: String, enum: WA_TRIGGERS, required: true },
    audience: { type: String, enum: ['creator', 'client'], required: true },
    body: { type: String, required: true },
    editable: { type: Boolean, default: true },
  },
  { timestamps: true }
)

withTenant(WaTemplateSchema)
WaTemplateSchema.index({ tenantId: 1, trigger: 1 }, { unique: true })

export default mongoose.model<IWaTemplate>('WaTemplate', WaTemplateSchema)
