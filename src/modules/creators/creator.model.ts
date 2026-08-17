import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export type Gender = 'male' | 'female_hijab' | 'female_non_hijab'
export type SocialPlatform = 'instagram' | 'tiktok' | 'threads' | 'x'
export type CreatorActivity = 'kol' | 'koc' | 'ugc' | 'affiliator' | 'live_streamer'
export type ComplianceStatus = 'ok' | 'sp1' | 'sp2_blacklist'

interface ISocialAccount {
  platform: SocialPlatform
  username: string
  profileUrl: string
  followers: number
}

interface IPerformanceScore {
  reliability: number
  performance: number
  communication: number | null
  quality: number
  overall: number
  updatedAt: Date
}

export interface ICreator extends Document {
  tenantId: Types.ObjectId
  name: string
  phone: string
  password?: string
  email?: string
  gender: Gender
  domicile: { province: string; city: string }
  socials: ISocialAccount[]
  activities: CreatorActivity[]
  niches: string[]
  nicheOther?: string
  contentStyles: string[]
  contentStyleOther?: string
  bankAccount?: { bankName: string; accountNumber: string; accountName: string }
  npwp?: string
  mediaKitUrl?: string
  portfolioLink?: string
  photoUrl?: string
  performanceScore: IPerformanceScore
  complianceStatus: ComplianceStatus
  sp1Until?: Date
  cancelCount: number
  source: 'form' | 'import'
  status: 'pending' | 'reviewing' | 'approved' | 'rejected'
  createdAt: Date
  updatedAt: Date
}

const SocialAccountSchema = new Schema<ISocialAccount>(
  {
    platform: { type: String, enum: ['instagram', 'tiktok', 'threads', 'x'], required: true },
    username: { type: String, required: true },
    profileUrl: { type: String, required: true },
    followers: { type: Number, required: true, default: 0 },
  },
  { _id: false }
)

const CreatorSchema = new Schema<ICreator>(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    password: String,
    email: String,
    gender: { type: String, enum: ['male', 'female_hijab', 'female_non_hijab'], required: true },
    domicile: {
      province: { type: String, required: true },
      city: { type: String, required: true },
    },
    socials: [SocialAccountSchema],
    activities: [{ type: String, enum: ['kol', 'koc', 'ugc', 'affiliator', 'live_streamer'] }],
    niches: [String],
    nicheOther: String,
    contentStyles: [String],
    contentStyleOther: String,
    bankAccount: {
      bankName: String,
      accountNumber: String,
      accountName: String,
    },
    npwp: String,
    mediaKitUrl: String,
    portfolioLink: String,
    photoUrl: String,
    performanceScore: {
      reliability: { type: Number, default: 0 },
      performance: { type: Number, default: 0 },
      communication: { type: Number, default: null },
      quality: { type: Number, default: 0 },
      overall: { type: Number, default: 0 },
      updatedAt: { type: Date, default: Date.now },
    },
    complianceStatus: { type: String, enum: ['ok', 'sp1', 'sp2_blacklist'], default: 'ok' },
    sp1Until: Date,
    cancelCount: { type: Number, default: 0 },
    source: { type: String, enum: ['form', 'import'], default: 'form' },
    status: { type: String, enum: ['pending', 'reviewing', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
)

withTenant(CreatorSchema)
CreatorSchema.index({ tenantId: 1, phone: 1 }, { unique: true })

export default mongoose.model<ICreator>('Creator', CreatorSchema)
