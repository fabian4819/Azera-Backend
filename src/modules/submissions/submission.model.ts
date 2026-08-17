import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export type SubmissionType = 'draft' | 'post'
export type SubmissionStatus = 'submitted' | 'approved' | 'revision_requested'

interface IParsedInsight {
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  reach?: number
  verifiedByUserId?: Types.ObjectId
  verifiedAt?: Date
}

export interface ISubmission extends Document {
  tenantId: Types.ObjectId
  campaignId: Types.ObjectId
  creatorId: Types.ObjectId
  type: SubmissionType
  link?: string
  insightScreenshotUrls: string[]
  parsedInsight?: IParsedInsight
  status: SubmissionStatus
  revisionCount: number
  revisionNotes?: string
  createdAt: Date
  updatedAt: Date
}

const SubmissionSchema = new Schema<ISubmission>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
    creatorId: { type: Schema.Types.ObjectId, ref: 'Creator', required: true },
    type: { type: String, enum: ['draft', 'post'], required: true },
    link: String,
    insightScreenshotUrls: [String],
    parsedInsight: {
      views: Number,
      likes: Number,
      comments: Number,
      shares: Number,
      saves: Number,
      reach: Number,
      verifiedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
      verifiedAt: Date,
    },
    status: { type: String, enum: ['submitted', 'approved', 'revision_requested'], default: 'submitted' },
    revisionCount: { type: Number, default: 0 },
    revisionNotes: String,
  },
  { timestamps: true }
)

withTenant(SubmissionSchema)
SubmissionSchema.index({ tenantId: 1, campaignId: 1, creatorId: 1 })

export default mongoose.model<ISubmission>('Submission', SubmissionSchema)
