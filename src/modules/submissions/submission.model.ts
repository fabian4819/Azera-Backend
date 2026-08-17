import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'
import { SocialPlatform } from '../creators/creator.model'

export type SubmissionType = 'draft' | 'post'
export type SubmissionStatus = 'submitted' | 'approved' | 'revision_requested'

/**
 * Metrik per platform (notes klien 17 Agu 2026):
 * - IG & TikTok: views, reach, likes, comments, shares, saves (semua ada)
 * - X & Threads: views, likes, comments, shares (= "Posting Ulang"/repost) — TIDAK ada reach/saves
 * Field yang tidak berlaku untuk platform tsb dibiarkan null, bukan 0.
 */
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
  /** Platform post ini — menentukan field insight mana yang berlaku & label parsing AI */
  platform: SocialPlatform
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
    platform: { type: String, enum: ['instagram', 'tiktok', 'threads', 'x'], required: true },
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
