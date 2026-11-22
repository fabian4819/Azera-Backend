import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/** Top creator yang dicatat manual (campaign yang belum punya portfolio). Top creator di portfolio
 * tidak disalin ke sini, ikut tampil langsung di menu Top Creator (lihat topCreator.routes.ts). */
export interface ITopCreator extends Document {
  tenantId: Types.ObjectId
  campaign: string
  brand?: string
  period?: string
  name: string
  username?: string
  phone?: string
  platform: string
  postLink?: string
  views?: number
  likes?: number
  comments?: number
  shares?: number
  createdAt: Date
  updatedAt: Date
}

const TopCreatorSchema = new Schema<ITopCreator>(
  {
    campaign: { type: String, required: true },
    brand: String,
    period: String,
    name: { type: String, required: true },
    username: String,
    phone: String,
    platform: { type: String, default: 'tiktok' },
    postLink: String,
    views: Number,
    likes: Number,
    comments: Number,
    shares: Number,
  },
  { timestamps: true }
)

withTenant(TopCreatorSchema)

export default mongoose.model<ITopCreator>('TopCreator', TopCreatorSchema)
