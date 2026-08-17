import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'
import { WA_TRIGGERS, WaTrigger } from './waTemplate.model'

export type WaMessageStatus = 'queued' | 'sent' | 'failed'

export interface IWaMessageLog extends Document {
  tenantId: Types.ObjectId
  trigger: WaTrigger
  to: string
  payload: string
  status: WaMessageStatus
  error?: string
  campaignId?: Types.ObjectId
  creatorId?: Types.ObjectId
  sentAt?: Date
  createdAt: Date
}

const WaMessageLogSchema = new Schema<IWaMessageLog>(
  {
    trigger: { type: String, enum: WA_TRIGGERS, required: true },
    to: { type: String, required: true },
    payload: { type: String, required: true },
    status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
    error: String,
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    creatorId: { type: Schema.Types.ObjectId, ref: 'Creator' },
    sentAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

withTenant(WaMessageLogSchema)
WaMessageLogSchema.index({ tenantId: 1, createdAt: -1 })

export default mongoose.model<IWaMessageLog>('WaMessageLog', WaMessageLogSchema)
