import mongoose, { Schema, Document, Types } from 'mongoose'

/**
 * DB-backed atomic counter for document numbers (invoice/quotation/SPK), one doc per
 * tenant+key (lihat nextDocumentNumber). Replaces bot-cashflow's file-based invoices/counter.json so the
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

/** Bulan & tahun menurut WIB — container jalan di UTC, jadi tanggal 1 jam 00:00-07:00 WIB tidak salah bulan */
function jakartaYearMonth(date: Date): { year: number; month: number } {
  const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' })
    .format(date).split('-').map(Number)
  return { year, month }
}

async function nextSeq(tenantId: Types.ObjectId | string, key: string): Promise<string> {
  const counter = await InvoiceCounterModel.findOneAndUpdate({ tenantId, key }, { $inc: { seq: 1 } }, { upsert: true, new: true })
  return String(counter.seq).padStart(3, '0')
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

/**
 * Penomoran template klien (24 Sep 2026), urut per bulan:
 * - invoice   INV/PT-ACN/MM/YYYY/NNN  (counter key YYYYMM — sama dengan nomor INV-AZK lama, urutannya lanjut)
 * - quotation QUO/PT-ACN/MM/YYYY/NNN
 * - spk_brand NNN/SPK/KOL/PT-ACN/<bulan romawi>/YYYY
 * Invoice dari menu Document & dari halaman Campaign berbagi counter yang sama.
 */
export async function nextDocumentNumber(
  tenantId: Types.ObjectId | string,
  kind: 'invoice' | 'quotation' | 'spk_brand',
  date = new Date()
): Promise<string> {
  const { year, month } = jakartaYearMonth(date)
  const mm = String(month).padStart(2, '0')
  const ym = `${year}${mm}`
  if (kind === 'invoice') return `INV/PT-ACN/${mm}/${year}/${await nextSeq(tenantId, ym)}`
  if (kind === 'quotation') return `QUO/PT-ACN/${mm}/${year}/${await nextSeq(tenantId, `quotation:${ym}`)}`
  return `${await nextSeq(tenantId, `spk:${ym}`)}/SPK/KOL/PT-ACN/${ROMAN[month - 1]}/${year}`
}

export function nextInvoiceNumber(tenantId: Types.ObjectId | string, date = new Date()): Promise<string> {
  return nextDocumentNumber(tenantId, 'invoice', date)
}

export default InvoiceCounterModel
