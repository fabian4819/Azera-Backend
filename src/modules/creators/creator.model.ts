import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export type Gender = 'male' | 'female_hijab' | 'female_non_hijab'
export type SocialPlatform = 'instagram' | 'tiktok' | 'threads' | 'x'
export type CreatorActivity = 'kol' | 'koc' | 'ugc' | 'affiliator' | 'live_streamer'
export type ComplianceStatus = 'ok' | 'sp1' | 'sp2_blacklist'

interface ISocialAccount {
  platform: SocialPlatform
  username: string
  /** Opsional sejak form KOL tidak lagi menanyakan link profil (admin bisa nebak dari username) */
  profileUrl?: string
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
  /** Opsional — creator hasil import historis (AD-28) mungkin belum punya data ini */
  gender?: Gender
  /** Tidak pernah diserialisasi ke JSON (lihat toJSON transform di bawah) — dashboard/API/sheet
   * cuma pernah lihat `age` (virtual, dihitung dari ini), bukan tanggal lahir mentahnya. */
  birthDate?: Date
  /** Virtual, dihitung dari birthDate — bukan field tersimpan */
  age?: number
  domicile?: { province?: string; city?: string }
  socials: ISocialAccount[]
  activities: CreatorActivity[]
  niches: string[]
  nicheOther?: string
  contentStyles: string[]
  contentStyleOther?: string
  bankAccount?: { bankName: string; accountNumber: string; accountName: string }
  npwp?: string
  /** AD-49: estimasi rate 1x video posting, sebagai referensi awal — bukan kesepakatan final */
  rateEstimateType?: 'nominal' | 'unknown'
  rateEstimateAmount?: number
  rateNegotiable?: 'yes' | 'no' | 'depends'
  mediaKitUrl?: string
  portfolioLink?: string
  photoUrl?: string
  /** AD-50: dikumpulkan di apply-flow campaign (step profil) — dipakai buat kirim produk & data
   * campaign yang butuh alamat fisik/almamater (mis. eligibility seragam sekolah/almet). */
  address?: string
  postalCode?: string
  school?: string
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
    profileUrl: { type: String },
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
    gender: { type: String, enum: ['male', 'female_hijab', 'female_non_hijab'] },
    birthDate: Date,
    domicile: {
      province: String,
      city: String,
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
    rateEstimateType: { type: String, enum: ['nominal', 'unknown'] },
    rateEstimateAmount: Number,
    rateNegotiable: { type: String, enum: ['yes', 'no', 'depends'] },
    mediaKitUrl: String,
    portfolioLink: String,
    photoUrl: String,
    address: String,
    postalCode: String,
    school: String,
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
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      // birthDate dipakai buat HITUNG usia saja — jangan pernah keluar ke response API. Berlaku
      // di semua endpoint (dashboard, dan sheet/export kalau ada nanti), bukan cuma di satu route.
      transform: (_doc, ret) => {
        delete ret.birthDate
        return ret
      },
    },
  }
)

// Usia dibulatkan ke bawah (belum ulang tahun tahun ini = belum genap) — bukan field tersimpan,
// selalu dihitung ulang dari birthDate saat dokumen diserialisasi.
CreatorSchema.virtual('age').get(function (this: ICreator) {
  if (!this.birthDate) return undefined
  const today = new Date()
  let age = today.getFullYear() - this.birthDate.getFullYear()
  const hadBirthdayThisYear =
    today.getMonth() > this.birthDate.getMonth() ||
    (today.getMonth() === this.birthDate.getMonth() && today.getDate() >= this.birthDate.getDate())
  if (!hadBirthdayThisYear) age -= 1
  return age
})

withTenant(CreatorSchema)
CreatorSchema.index({ tenantId: 1, phone: 1 }, { unique: true })
// sparse: true — creator lama (source 'import') mungkin belum punya email, jangan sampai
// dianggap "duplikat" satu sama lain gara-gara sama-sama tidak punya email.
CreatorSchema.index({ tenantId: 1, email: 1 }, { unique: true, sparse: true })

export default mongoose.model<ICreator>('Creator', CreatorSchema)
