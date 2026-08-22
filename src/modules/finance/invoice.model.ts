import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export type InvoiceStatus = 'draft' | 'sent' | 'waiting_verification' | 'paid'

interface IInvoiceItem {
  name: string
  description?: string
  qty: number | null
  rate: number
}

export interface IInvoice extends Document {
  tenantId: Types.ObjectId
  campaignId: Types.ObjectId
  brandId: Types.ObjectId
  /** Format INV-AZK-YYYYMM-NNN, kompatibel dengan penomoran bot-cashflow */
  number: string
  /** Kode akses halaman publik invoice — "link + kode" (Pasal spec checklist) */
  accessCode: string
  billTo: string
  items: IInvoiceItem[]
  discount: number
  subtotal: number
  total: number
  isDp: boolean
  issueDate: Date
  dueDate: Date
  status: InvoiceStatus
  paymentProofUrl?: string
  verifiedByUserId?: Types.ObjectId
  verifiedAt?: Date
  pdfUrl?: string
  createdAt: Date
  updatedAt: Date
}

const InvoiceItemSchema = new Schema<IInvoiceItem>(
  {
    name: { type: String, required: true },
    description: String,
    qty: Number,
    rate: { type: Number, required: true },
  },
  { _id: false }
)

const InvoiceSchema = new Schema<IInvoice>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', required: true },
    number: { type: String, required: true },
    accessCode: { type: String, required: true },
    billTo: { type: String, required: true },
    items: [InvoiceItemSchema],
    discount: { type: Number, default: 0 },
    subtotal: { type: Number, required: true },
    total: { type: Number, required: true },
    isDp: { type: Boolean, default: false },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ['draft', 'sent', 'waiting_verification', 'paid'], default: 'draft' },
    paymentProofUrl: String,
    verifiedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
    pdfUrl: String,
  },
  { timestamps: true }
)

withTenant(InvoiceSchema)
InvoiceSchema.index({ tenantId: 1, number: 1 }, { unique: true })

export default mongoose.model<IInvoice>('Invoice', InvoiceSchema)
