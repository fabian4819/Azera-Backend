import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/**
 * Akun PIC/Handle-by campaign. Beda dari draf awal (hierarki akun per campaign),
 * satu akun bisa terhubung ke banyak campaign. Sign up TIDAK butuh accessCode,
 * akun dibuat kosong (campaignIds: []), admin yang assign campaign ke akun ini
 * dari CampaignDetail (lihat campaign.routes.ts endpoint /:id/pic), baru muncul
 * di dashboard PIC.
 */
export interface IPicUser extends Document {
  tenantId: Types.ObjectId
  name: string
  email: string
  phone: string
  password: string
  campaignIds: Types.ObjectId[]
  /** AD-adjustment-6: info bank/e-wallet terkonfirmasi, dipakai di Recap Payment. */
  paymentInfo?: {
    bankName?: string
    accountNumber?: string
    accountName?: string
    ewalletType?: string
    ewalletNumber?: string
    updatedAt?: Date
  }
  /** Balasan WA mentah menunggu konfirmasi admin, BELUM dianggap final sampai admin konfirmasi. */
  pendingPaymentReply?: { raw: string; receivedAt: Date }
  /** Kapan admin terakhir minta info bank/e-wallet lewat WA; dipakai cocokkan balasan masuk. */
  paymentInfoRequestedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const PicUserSchema = new Schema<IPicUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    campaignIds: [{ type: Schema.Types.ObjectId, ref: 'Campaign' }],
    paymentInfo: {
      bankName: String,
      accountNumber: String,
      accountName: String,
      ewalletType: String,
      ewalletNumber: String,
      updatedAt: Date,
    },
    pendingPaymentReply: {
      raw: String,
      receivedAt: Date,
    },
    paymentInfoRequestedAt: Date,
  },
  { timestamps: true }
)

withTenant(PicUserSchema)
PicUserSchema.index({ tenantId: 1, email: 1 }, { unique: true })

export default mongoose.model<IPicUser>('PicUser', PicUserSchema)
