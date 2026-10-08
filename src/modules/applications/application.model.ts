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
  /** AD-47: jawaban untuk Campaign.customFields, keyed by ICustomField.id */
  customAnswers: Record<string, string | string[]>
  status: ApplicationStatus
  decidedByUserId?: Types.ObjectId
  decidedAt?: Date
  /** PIC/Handle-by yang "pegang" creator ini di campaign, harus salah satu PIC yang sudah
   * di-assign ke campaign (lihat POST /:id/pic di campaign.routes.ts), divalidasi di
   * application.routes.ts. Dipakai buat filter dashboard PIC portal per-creator, bukan cuma per-campaign. */
  picUserId?: Types.ObjectId
  /** Isian bebas "Handle by" dari form Apply (bukan akun, beda dengan PIC) */
  handleBy?: string
  /** Nilai kolom progress bebas (Campaign.progressColumns tanpa `submission`), keyed by column id */
  progress: Record<string, string | number>
  /** Magic link portal creator untuk campaign ini (/portal/:token), dibuat saat accepted */
  portalToken?: string
  /** AD-25: pelacakan pembayaran ke creator, follow-up manual via admin, tanpa otomasi */
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
    customAnswers: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    picUserId: { type: Schema.Types.ObjectId, ref: 'PicUser' },
    handleBy: String,
    progress: { type: Schema.Types.Mixed, default: {} },
    portalToken: String,
    creatorPaymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
  },
  { timestamps: true }
)

withTenant(ApplicationSchema)
ApplicationSchema.index({ tenantId: 1, campaignId: 1, creatorId: 1 }, { unique: true })
ApplicationSchema.index({ portalToken: 1 }, { unique: true, partialFilterExpression: { portalToken: { $type: 'string' } } })

export default mongoose.model<IApplication>('Application', ApplicationSchema)
