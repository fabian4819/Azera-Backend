import mongoose, { Schema, Document } from 'mongoose'

/** Jasa yang ditanyakan di alur bot WhatsApp (lihat leadBot.service.ts) — beda taksonomi dari `tujuan` form web */
export const BRAND_JASA_OPTIONS = [
  { key: 'engagement_boost', label: 'Engagement Boost' },
  { key: 'kol_marketing', label: 'KOL Marketing' },
  { key: 'affiliate_marketing', label: 'Affiliate Marketing' },
] as const

export type BrandJasa = (typeof BRAND_JASA_OPTIONS)[number]['key']

export interface IBrand extends Document {
  namaBrand: string
  namaPIC: string
  whatsapp: string
  email?: string
  website?: string
  kategori?: string
  paket?: string
  targetAudience: string
  budget: string
  tujuan: string[]
  jasa?: BrandJasa
  durasi?: string
  deskripsi: string
  status: 'new' | 'reviewed' | 'contacted'
  notes?: string
  /** Dari mana lead ini masuk — form web landing page atau bot WhatsApp */
  source: 'web' | 'whatsapp'
  createdAt: Date
  updatedAt: Date
}

const BrandSchema = new Schema<IBrand>(
  {
    namaBrand: { type: String, required: true },
    namaPIC: { type: String, required: true },
    whatsapp: { type: String, required: true },
    email: String,
    website: String,
    kategori: String,
    paket: String,
    targetAudience: { type: String, required: true },
    budget: { type: String, required: true },
    tujuan: [String],
    jasa: { type: String, enum: BRAND_JASA_OPTIONS.map((o) => o.key) },
    durasi: String,
    deskripsi: { type: String, required: true },
    status: { type: String, enum: ['new', 'reviewed', 'contacted'], default: 'new' },
    notes: String,
    source: { type: String, enum: ['web', 'whatsapp'], default: 'web' },
  },
  { timestamps: true }
)

export default mongoose.model<IBrand>('Brand', BrandSchema)
