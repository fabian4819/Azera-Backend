import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export type ViolationType = 'cancelled_after_accepted' | 'no_show' | 'late_upload' | 'missing_insight'

export interface ICreatorHistory extends Document {
  tenantId: Types.ObjectId
  creatorId: Types.ObjectId
  campaignId: Types.ObjectId
  brandId: Types.ObjectId
  uploadedOnTime: boolean
  revisions: number
  responseTimeHours?: number
  violation?: ViolationType
  createdAt: Date
  updatedAt: Date
}

const CreatorHistorySchema = new Schema<ICreatorHistory>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'Creator', required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', required: true },
    uploadedOnTime: { type: Boolean, default: true },
    revisions: { type: Number, default: 0 },
    responseTimeHours: Number,
    violation: { type: String, enum: ['cancelled_after_accepted', 'no_show', 'late_upload', 'missing_insight'] },
  },
  { timestamps: true }
)

withTenant(CreatorHistorySchema)
CreatorHistorySchema.index({ tenantId: 1, creatorId: 1 })
CreatorHistorySchema.index({ tenantId: 1, brandId: 1, creatorId: 1 })

export default mongoose.model<ICreatorHistory>('CreatorHistory', CreatorHistorySchema)
