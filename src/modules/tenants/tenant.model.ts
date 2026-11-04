import mongoose, { Schema, Document } from 'mongoose'

export interface ITenant extends Document {
  name: string
  slug: string
  settings: {
    waNumber?: string
    contactEmail?: string
    /** Toggle bot balasan otomatis (leadBot) per bot, undefined dianggap aktif */
    autoReply?: { partnership?: boolean; creator?: boolean }
    /** Kolom tambahan Rekap Keuangan yang dibuat owner. income/expense ikut dihitung ke uang masuk/keluar. */
    financeRecapColumns?: { key: string; label: string; type: 'text' | 'income' | 'expense' }[]
    /** Spreadsheet Rekap Keuangan di Shared Drive (financeSheet.service.ts) */
    financeRecapSpreadsheetId?: string
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
      autoReply: { partnership: Boolean, creator: Boolean },
      financeRecapColumns: [{ _id: false, key: String, label: String, type: { type: String, enum: ['text', 'income', 'expense'] } }],
      financeRecapSpreadsheetId: String,
    },
  },
  { timestamps: true }
)

export default mongoose.model<ITenant>('Tenant', TenantSchema)
