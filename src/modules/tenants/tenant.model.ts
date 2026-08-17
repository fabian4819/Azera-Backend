import mongoose, { Schema, Document } from 'mongoose'

export interface ITenant extends Document {
  name: string
  slug: string
  settings: {
    waNumber?: string
    contactEmail?: string
  }
  createdAt: Date
  updatedAt: Date
}

const TenantSchema = new Schema<ITenant>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    settings: {
      waNumber: String,
      contactEmail: String,
    },
  },
  { timestamps: true }
)

export default mongoose.model<ITenant>('Tenant', TenantSchema)
