import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/**
 * AD-33: kategori dikonfirmasi klien (Review PDF hal. 9) — Brand -> Campaign -> kategori.
 * Sebagian kategori (Brief, Insight, Final Content, Final Report, Invoice, Case Study) biasanya
 * sudah otomatis terisi dari data lain (briefContent, Submission, Document, Invoice) — lihat
 * asset.service.ts getAssetLibrary(). Model ini menyimpan file yang di-upload manual.
 */
export const ASSET_CATEGORIES = [
  'brief', 'logo', 'visual', 'caption', 'draft',
  'final_content', 'insight', 'final_report', 'invoice', 'case_study',
] as const

export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

export interface IAsset extends Document {
  tenantId: Types.ObjectId
  campaignId: Types.ObjectId
  brandId: Types.ObjectId
  category: AssetCategory
  fileName: string
  fileUrl: string
  tags: string[]
  uploadedByUserId: Types.ObjectId
  createdAt: Date
}

const AssetSchema = new Schema<IAsset>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', required: true },
    category: { type: String, enum: ASSET_CATEGORIES, required: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    tags: { type: [String], default: [] },
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

withTenant(AssetSchema)
AssetSchema.index({ tenantId: 1, campaignId: 1, category: 1 })
AssetSchema.index({ tenantId: 1, tags: 1 })

export default mongoose.model<IAsset>('Asset', AssetSchema)
