import mongoose, { Schema, Document } from 'mongoose'

export interface IBrand extends Document {
  namaBrand: string
  namaPIC: string
  whatsapp: string
  email: string
  website?: string
  kategori: string
  paket: string
  targetAudience: string
  budget: string
  tujuan: string[]
  durasi: string
  deskripsi: string
  status: 'new' | 'reviewed' | 'contacted'
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const BrandSchema = new Schema<IBrand>(
  {
    namaBrand: { type: String, required: true },
    namaPIC: { type: String, required: true },
    whatsapp: { type: String, required: true },
    email: { type: String, required: true },
    website: String,
    kategori: { type: String, required: true },
    paket: { type: String, required: true },
    targetAudience: { type: String, required: true },
    budget: { type: String, required: true },
    tujuan: [String],
    durasi: { type: String, required: true },
    deskripsi: { type: String, required: true },
    status: { type: String, enum: ['new', 'reviewed', 'contacted'], default: 'new' },
    notes: String,
  },
  { timestamps: true }
)

export default mongoose.model<IBrand>('Brand', BrandSchema)
