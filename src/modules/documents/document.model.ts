import mongoose, { Schema, Document as MongoDocument, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export type DocumentType =
  | 'quotation'
  | 'spk_brand'
  | 'spk_agency'
  | 'spk_creator'
  | 'invoice'
  | 'report'
  | 'case_study'

export interface IDocument extends MongoDocument {
  tenantId: Types.ObjectId
  type: DocumentType
  campaignId?: Types.ObjectId
  brandId?: Types.ObjectId
  data: Record<string, unknown>
  pdfUrl?: string
  version: number
  createdAt: Date
  updatedAt: Date
}

const DocumentSchema = new Schema<IDocument>(
  {
    type: {
      type: String,
      enum: ['quotation', 'spk_brand', 'spk_agency', 'spk_creator', 'invoice', 'report', 'case_study'],
      required: true,
    },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand' },
    data: { type: Schema.Types.Mixed, default: {} },
    pdfUrl: String,
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
)

withTenant(DocumentSchema)
DocumentSchema.index({ tenantId: 1, campaignId: 1, type: 1 })

export default mongoose.model<IDocument>('Document', DocumentSchema)
