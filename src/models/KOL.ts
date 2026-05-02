import mongoose, { Schema, Document } from 'mongoose'

export interface IKOL extends Document {
  namaLengkap: string
  whatsapp: string
  email: string
  kota: string
  tanggalLahir: Date
  jenisKelamin: string
  niche: string[]
  instagram?: { username: string; followers: number; avgLike: number; avgComment: number; er: number }
  tiktok?: { username: string; followers: number; avgLike: number; avgComment: number; avgViews: number; er: number; viewRate: number }
  youtube?: { channel: string; subscribers: number; avgViews: number; er: number }
  rateCard?: number
  portfolioLink?: string
  pengalaman?: string
  fotoProfil?: string
  status: 'pending' | 'reviewing' | 'approved' | 'rejected'
  catatanKurasi?: string
  alasanReject?: string
  createdAt: Date
  updatedAt: Date
}

const SocialStatsSchema = new Schema({
  username: String,
  followers: Number,
  avgLike: Number,
  avgComment: Number,
  avgViews: Number,
  er: Number,
  viewRate: Number,
  channel: String,
  subscribers: Number,
}, { _id: false })

const KOLSchema = new Schema<IKOL>(
  {
    namaLengkap: { type: String, required: true },
    whatsapp: { type: String, required: true },
    email: { type: String, required: true },
    kota: { type: String, required: true },
    tanggalLahir: { type: Date, required: true },
    jenisKelamin: { type: String, required: true },
    niche: [String],
    instagram: SocialStatsSchema,
    tiktok: SocialStatsSchema,
    youtube: SocialStatsSchema,
    rateCard: Number,
    portfolioLink: String,
    pengalaman: String,
    fotoProfil: String,
    status: { type: String, enum: ['pending', 'reviewing', 'approved', 'rejected'], default: 'pending' },
    catatanKurasi: String,
    alasanReject: String,
  },
  { timestamps: true }
)

export default mongoose.model<IKOL>('KOL', KOLSchema)
