import mongoose, { Schema, Document } from 'mongoose'

/** AD-49: satu creator di showcase "Top Creator" — diisi manual oleh admin
 * (belum ada relasi otomatis ke Campaign/Submission asli, lihat 09-open-questions.md).
 * postLink dipakai untuk embed resmi Instagram/TikTok (oEmbed), bukan file video —
 * sistem ini tidak punya penyimpanan video sendiri. */
export type CreatorPlatform = 'instagram' | 'tiktok'

export interface ITopCreator {
  name: string
  platform: CreatorPlatform
  postLink: string
  views?: string
  likes?: string
  comments?: string
  shares?: string
}

export interface IPortfolioMetrics {
  totalImpression?: string
  accountsReached?: string
  totalEngagement?: string
  totalFollowers?: string
  avgEngagementRate?: string
  costPerView?: string
}

export interface IPortfolio extends Document {
  brand: string
  logo: string
  hashtag: string
  category: string
  kolCount: number
  reach: string
  engagement: string
  contents: string[]
  featured: boolean
  /** Judul campaign spesifik (mis. "Serambi MyPertamina KOL Campaign"), beda dari nama brand */
  title?: string
  objective?: string
  metrics?: IPortfolioMetrics
  topCreators: ITopCreator[]
  createdAt: Date
  updatedAt: Date
}

const TopCreatorSchema = new Schema<ITopCreator>(
  {
    name: { type: String, required: true },
    platform: { type: String, enum: ['instagram', 'tiktok'], required: true },
    postLink: { type: String, required: true },
    views: String,
    likes: String,
    comments: String,
    shares: String,
  },
  { _id: false }
)

const PortfolioSchema = new Schema<IPortfolio>(
  {
    brand: { type: String, required: true },
    logo: { type: String, required: true },
    hashtag: { type: String, required: true },
    category: { type: String, required: true },
    kolCount: { type: Number, required: true },
    reach: { type: String, required: true },
    engagement: { type: String, required: true },
    contents: [String],
    featured: { type: Boolean, default: false },
    title: String,
    objective: String,
    metrics: {
      totalImpression: String,
      accountsReached: String,
      totalEngagement: String,
      totalFollowers: String,
      avgEngagementRate: String,
      costPerView: String,
    },
    topCreators: { type: [TopCreatorSchema], default: [] },
  },
  { timestamps: true }
)

export default mongoose.model<IPortfolio>('Portfolio', PortfolioSchema)
