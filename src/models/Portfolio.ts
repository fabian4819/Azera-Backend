import mongoose, { Schema, Document } from 'mongoose'

export const PORTFOLIO_CATEGORIES = ['KOL Campaign', 'KOC Campaign', 'Affiliate Campaign', 'Event Creator Activation'] as const
export const RESULT_PLATFORMS = ['instagram', 'tiktok', 'threads', 'x', 'youtube', 'other'] as const

/** AD-49: satu creator di showcase "Top Creator" — diisi manual oleh admin
 * (belum ada relasi otomatis ke Campaign/Submission asli, lihat 09-open-questions.md).
 * postLink (opsional) dipakai untuk embed resmi Instagram/TikTok (oEmbed), bukan file video —
 * sistem ini tidak punya penyimpanan video sendiri. */
export type CreatorPlatform = 'instagram' | 'tiktok'

export interface ITopCreator {
  name: string
  platform: CreatorPlatform
  postLink?: string
  views?: string
  likes?: string
  comments?: string
  shares?: string
}

/** Satu baris "Platform dan Hasil". Angka opsional disimpan null bila kosong —
 * kosong ≠ nol (data tidak tersedia). reach..er = "Metrik Tambahan". */
export interface IPlatformResult {
  platform: (typeof RESULT_PLATFORMS)[number]
  platformName?: string
  creators: number | null
  posts: number | null
  views?: number | null
  reach?: number | null
  impressions?: number | null
  engagement?: number | null
  er?: string
  showExtraPublic: boolean
}

/** Legacy (sebelum revisi Sep 2026) — tidak diedit lagi dari admin, hanya fallback tampilan data lama. */
export interface IPortfolioMetrics {
  totalImpression?: string
  accountsReached?: string
  totalEngagement?: string
  totalFollowers?: string
  avgEngagementRate?: string
  costPerView?: string
}

export interface IPortfolio extends Document {
  status: 'draft' | 'published'
  brand: string
  title?: string
  category: string
  objective?: string
  niches: string[]
  period?: string
  hashtag?: string
  /** Total Kreator Aktif (unik di seluruh campaign) — nama field lama dipertahankan agar data lama tetap terbaca. */
  kolCount?: number
  deliverables?: string
  scope: string[]
  scopeOther?: string
  partnerAgency?: string
  platforms: IPlatformResult[]
  cpv?: string
  cpvPublic: boolean
  affiliate?: { clicks?: string; orders?: string; gmv?: string }
  logo?: string
  contents: string[]
  featured: boolean
  topCreators: ITopCreator[]
  reach?: string
  engagement?: string
  metrics?: IPortfolioMetrics
  createdAt: Date
  updatedAt: Date
}

const TopCreatorSchema = new Schema<ITopCreator>(
  {
    name: { type: String, required: true },
    platform: { type: String, enum: ['instagram', 'tiktok'], required: true },
    postLink: String,
    views: String,
    likes: String,
    comments: String,
    shares: String,
  },
  { _id: false }
)

const PlatformResultSchema = new Schema<IPlatformResult>(
  {
    platform: { type: String, enum: RESULT_PLATFORMS, required: true },
    platformName: String,
    // wajib saat publish (dicek di route admin), draft boleh kosong
    creators: { type: Number, min: 0, default: null },
    posts: { type: Number, min: 0, default: null },
    views: { type: Number, min: 0, default: null },
    reach: { type: Number, min: 0, default: null },
    impressions: { type: Number, min: 0, default: null },
    engagement: { type: Number, min: 0, default: null },
    er: String,
    showExtraPublic: { type: Boolean, default: false },
  },
  { _id: false }
)

const PortfolioSchema = new Schema<IPortfolio>(
  {
    // tanpa field status = data lama yang sudah tayang → diperlakukan published (filter publik pakai $ne: 'draft')
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    brand: { type: String, required: true },
    title: String,
    // 'Event Activation' = nama kategori lama, dinormalkan saat dibaca
    category: { type: String, default: '', get: (v: string) => (v === 'Event Activation' ? 'Event Creator Activation' : v) },
    objective: String,
    niches: { type: [String], default: [] },
    period: String,
    hashtag: String,
    kolCount: Number,
    deliverables: String,
    scope: { type: [String], default: [] },
    scopeOther: String,
    partnerAgency: String,
    platforms: { type: [PlatformResultSchema], default: [] },
    cpv: String,
    cpvPublic: { type: Boolean, default: false },
    affiliate: { clicks: String, orders: String, gmv: String },
    logo: String,
    contents: [String],
    featured: { type: Boolean, default: false },
    topCreators: { type: [TopCreatorSchema], default: [] },
    reach: String,
    engagement: String,
    metrics: {
      totalImpression: String,
      accountsReached: String,
      totalEngagement: String,
      totalFollowers: String,
      avgEngagementRate: String,
      costPerView: String,
    },
  },
  { timestamps: true, toJSON: { getters: true } }
)

export default mongoose.model<IPortfolio>('Portfolio', PortfolioSchema)
