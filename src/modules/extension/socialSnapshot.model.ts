import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/**
 * Platform yang bisa ditarik ekstensi KOL Lister. Lebih luas dari Creator.socials
 * (yang cuma ig/tiktok/threads/x): facebook & youtube masih boleh masuk sebagai
 * KOL prospek di Radar, tapi tidak bisa ditautkan ke akun sosial Creator.
 */
export type SnapshotPlatform = 'instagram' | 'tiktok' | 'threads' | 'x' | 'facebook' | 'youtube'
export const SNAPSHOT_PLATFORMS: SnapshotPlatform[] = [
  'instagram', 'tiktok', 'threads', 'x', 'facebook', 'youtube',
]

/**
 * Satu tarikan metrik profil KOL dari ekstensi KOL Lister. Time-series: satu
 * baris per tarikan, tidak ditimpa — jadi pertumbuhan followers / ER bisa
 * digambar sebagai grafik di CreatorDetail.
 *
 * `creatorId` null = KOL prospek (username belum ada di DB_KOL). Muncul di
 * halaman "KOL Radar", staf bisa convert jadi Creator.
 */
export interface ISocialSnapshot extends Document {
  tenantId: Types.ObjectId
  platform: SnapshotPlatform
  /** handle tanpa @, lowercase — kunci pencocokan ke Creator.socials.username */
  username: string
  profileUrl?: string
  displayName?: string
  avatarUrl?: string
  bio?: string
  isVerified?: boolean

  followers?: number
  following?: number
  postsCount?: number

  avgLikes?: number
  avgComments?: number
  avgViews?: number
  avgShares?: number
  medLikes?: number
  medComments?: number
  medViews?: number

  /** persen, mis. 4.62 berarti 4,62% (rata-rata) */
  engagementRate?: number
  engagementRateMedian?: number
  engagementRateViews?: number
  /** 'followers' (IG/TikTok/Threads/X/FB) atau 'views' (YouTube) */
  erBasis?: string

  /** ukuran sampel yang dipakai menghitung rata-rata/median (default 12 post terakhir) */
  postsSampled?: number
  totalCollected?: number
  paidPosts?: number
  organicPosts?: number
  postsPerWeek?: number
  postRangeDays?: number
  /** rasio post terbesar : median — >= 5 berarti rata-rata ditarik outlier */
  outlierRatio?: number
  roundedNumbers?: boolean

  /** rincian per post di sampel */
  sampleRows?: Array<{
    post?: string
    url?: string
    date?: string
    approxDate?: boolean
    format?: string
    title?: string
    likes?: number | null
    comments?: number | null
    views?: number | null
    shares?: number | null
    saves?: number | null
    paid?: boolean
  }>

  /** field mentah apa adanya dari scraper, buat audit kalau parsing meleset */
  raw?: Record<string, unknown>
  /** field yang scraper GAGAL ambil (butuh isi manual) */
  missingFields: string[]

  /** diisi staf di panel ekstensi — berguna untuk prospek yang belum jadi Creator */
  niche?: string
  notes?: string
  /** campaign yang lagi dipertimbangkan buat KOL ini (shortlist, belum deal) */
  shortlistCampaign?: string

  creatorId?: Types.ObjectId
  capturedByUserId: Types.ObjectId
  captureIntentId?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const SocialSnapshotSchema = new Schema<ISocialSnapshot>(
  {
    platform: { type: String, enum: SNAPSHOT_PLATFORMS, required: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    profileUrl: String,
    displayName: String,
    avatarUrl: String,
    bio: String,
    isVerified: Boolean,

    followers: Number,
    following: Number,
    postsCount: Number,

    avgLikes: Number,
    avgComments: Number,
    avgViews: Number,
    avgShares: Number,
    medLikes: Number,
    medComments: Number,
    medViews: Number,

    engagementRate: Number,
    engagementRateMedian: Number,
    engagementRateViews: Number,
    erBasis: String,

    postsSampled: Number,
    totalCollected: Number,
    paidPosts: Number,
    organicPosts: Number,
    postsPerWeek: Number,
    postRangeDays: Number,
    outlierRatio: Number,
    roundedNumbers: Boolean,

    sampleRows: [
      new Schema(
        {
          post: String,
          url: String,
          date: String,
          approxDate: Boolean,
          format: String,
          title: String,
          likes: Number,
          comments: Number,
          views: Number,
          shares: Number,
          saves: Number,
          paid: Boolean,
        },
        { _id: false }
      ),
    ],

    raw: { type: Schema.Types.Mixed },
    missingFields: { type: [String], default: [] },
    niche: String,
    notes: String,
    shortlistCampaign: String,

    creatorId: { type: Schema.Types.ObjectId, ref: 'Creator' },
    capturedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    captureIntentId: { type: Schema.Types.ObjectId, ref: 'ExtensionCaptureIntent' },
  },
  { timestamps: true }
)

withTenant(SocialSnapshotSchema)
SocialSnapshotSchema.index({ tenantId: 1, platform: 1, username: 1, createdAt: -1 })
SocialSnapshotSchema.index({ tenantId: 1, creatorId: 1, createdAt: -1 })

export default mongoose.model<ISocialSnapshot>('SocialSnapshot', SocialSnapshotSchema)
