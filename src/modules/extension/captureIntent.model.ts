import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'
import { SocialPlatform } from '../creators/creator.model'

/**
 * Alur "redirect dari web": staf di CreatorDetail / CampaignDetail klik "Buka
 * profil & tarik metrik". Server bikin intent ini, balikin URL sosmed dengan
 * hash `#azk=<intentId>`. Ekstensi baca hash, tanya server intent-nya buat apa
 * (target creator / submission), scrape, lalu fulfill — hasilnya langsung
 * nempel ke record yang benar tanpa staf pilih manual.
 */
export type CaptureIntentType = 'profile' | 'post'
export type CaptureIntentStatus = 'pending' | 'fulfilled' | 'expired'

export interface IExtensionCaptureIntent extends Document {
  tenantId: Types.ObjectId
  createdByUserId: Types.ObjectId
  type: CaptureIntentType
  platform: SocialPlatform
  /** handle (profile) atau kosong (post) */
  handle?: string
  targetUrl: string
  creatorId?: Types.ObjectId
  submissionId?: Types.ObjectId
  campaignId?: Types.ObjectId
  label: string
  status: CaptureIntentStatus
  resultSnapshotId?: Types.ObjectId
  fulfilledAt?: Date
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

const CaptureIntentSchema = new Schema<IExtensionCaptureIntent>(
  {
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['profile', 'post'], required: true },
    platform: { type: String, enum: ['instagram', 'tiktok', 'threads', 'x'], required: true },
    handle: String,
    targetUrl: { type: String, required: true },
    creatorId: { type: Schema.Types.ObjectId, ref: 'Creator' },
    submissionId: { type: Schema.Types.ObjectId, ref: 'Submission' },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    label: { type: String, required: true },
    status: { type: String, enum: ['pending', 'fulfilled', 'expired'], default: 'pending' },
    resultSnapshotId: { type: Schema.Types.ObjectId, ref: 'SocialSnapshot' },
    fulfilledAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
)

withTenant(CaptureIntentSchema)
// TTL: intent kadaluarsa dibersihkan otomatis 1 jam setelah expiresAt
CaptureIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 })

export default mongoose.model<IExtensionCaptureIntent>('ExtensionCaptureIntent', CaptureIntentSchema)
