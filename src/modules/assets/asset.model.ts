import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/**
 * Kategori Digital Asset Library — struktur Brand → Campaign → kategori,
 * ACC klien 16 Agu (docs/plan/modul-5-asset-template-landing.md)
 */
export const ASSET_FOLDERS = [
  'brief',
  'logo',
  'visual',
  'caption',
  'draft',
  'final_content',
  'insight',
  'final_report',
  'invoice',
  'case_study',
] as const

export type AssetFolder = (typeof ASSET_FOLDERS)[number]

export interface IAsset extends Document {
  tenantId: Types.ObjectId
  brandId: Types.ObjectId
  campaignId?: Types.ObjectId
  folder: AssetFolder
  name: string
  url: string
  mime: string
  uploadedByUserId?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const AssetSchema = new Schema<IAsset>(
  {
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    folder: { type: String, enum: ASSET_FOLDERS, required: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    mime: { type: String, required: true },
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

withTenant(AssetSchema)
AssetSchema.index({ tenantId: 1, brandId: 1, campaignId: 1, folder: 1 })

export default mongoose.model<IAsset>('Asset', AssetSchema)
