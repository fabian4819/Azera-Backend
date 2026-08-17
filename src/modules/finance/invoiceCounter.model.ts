import mongoose, { Schema, Document, Types } from 'mongoose'

/**
 * DB-backed atomic counter for invoice numbers (INV-AZK-YYYYMM-NNN), one doc per
 * tenant+month. Replaces bot-cashflow's file-based invoices/counter.json so the
 * platform and the WhatsApp bot never race on the same sequence — see
 * docs/plan/09-open-questions.md item 2 (counter migration).
 */
export interface IInvoiceCounter extends Document {
  tenantId: Types.ObjectId
  key: string // YYYYMM
  seq: number
}

const InvoiceCounterSchema = new Schema<IInvoiceCounter>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  key: { type: String, required: true },
  seq: { type: Number, default: 0 },
})

InvoiceCounterSchema.index({ tenantId: 1, key: 1 }, { unique: true })

const InvoiceCounterModel = mongoose.model<IInvoiceCounter>('InvoiceCounter', InvoiceCounterSchema)

export async function nextInvoiceNumber(tenantId: Types.ObjectId | string, date = new Date()): Promise<string> {
  const key = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`
  const counter = await InvoiceCounterModel.findOneAndUpdate(
    { tenantId, key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  )
  const seq = String(counter.seq).padStart(3, '0')
  return `INV-AZK-${key}-${seq}`
}

export default InvoiceCounterModel
