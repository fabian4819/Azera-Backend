import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export interface IFinanceRecord extends Document {
  tenantId: Types.ObjectId
  campaignId: Types.ObjectId
  revenue: number
  feeCreator: number
  feePic: number
  feeMg: number
  reimburse: number
  ads: number
  opex: number
  discount: number
  /** Fee yang diisi manual admin (atau dari import); fee lain dihitung otomatis = fee per creator x creator di-approve */
  feeManual: ('feeCreator' | 'feePic' | 'feeMg')[]
  profit: number
  createdAt: Date
  updatedAt: Date
}

const FinanceRecordSchema = new Schema<IFinanceRecord>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, unique: true },
    revenue: { type: Number, default: 0 },
    feeCreator: { type: Number, default: 0 },
    feePic: { type: Number, default: 0 },
    feeMg: { type: Number, default: 0 },
    reimburse: { type: Number, default: 0 },
    ads: { type: Number, default: 0 },
    opex: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    feeManual: { type: [String], enum: ['feeCreator', 'feePic', 'feeMg'], default: [] },
    profit: { type: Number, default: 0 },
  },
  { timestamps: true }
)

withTenant(FinanceRecordSchema)

export default mongoose.model<IFinanceRecord>('FinanceRecord', FinanceRecordSchema)
