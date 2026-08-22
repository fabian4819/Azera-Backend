import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export type CurationResult = 'highly_recommended' | 'recommended' | 'need_review' | 'rejected'
export type ApplicationStatus = 'pending' | 'accepted' | 'rejected'

export interface IApplication extends Document {
  tenantId: Types.ObjectId
  campaignId: Types.ObjectId
  creatorId: Types.ObjectId
  answers: {
    followers?: number
    engagement?: number
    niches?: string[]
    notes?: string
  }
  curationResult: CurationResult
  curationReason?: string
  status: ApplicationStatus
  decidedByUserId?: Types.ObjectId
  decidedAt?: Date
  /** AD-25: pelacakan pembayaran ke creator — follow-up manual via admin, tanpa otomasi */
  creatorPaymentStatus: 'unpaid' | 'paid'
  createdAt: Date
  updatedAt: Date
}

const ApplicationSchema = new Schema<IApplication>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
    creatorId: { type: Schema.Types.ObjectId, ref: 'Creator', required: true },
    answers: {
      followers: Number,
      engagement: Number,
      niches: [String],
      notes: String,
    },
    curationResult: {
      type: String,
      enum: ['highly_recommended', 'recommended', 'need_review', 'rejected'],
      default: 'need_review',
    },
    curationReason: String,
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    creatorPaymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
  },
  { timestamps: true }
)

withTenant(ApplicationSchema)
ApplicationSchema.index({ tenantId: 1, campaignId: 1, creatorId: 1 }, { unique: true })

export default mongoose.model<IApplication>('Application', ApplicationSchema)
