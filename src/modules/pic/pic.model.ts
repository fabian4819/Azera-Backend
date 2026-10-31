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
  /** Nama Management/Agency (dulu "Nama MG"), dipakai sebagai label PIC di mana-mana */
  name: string
  /** Data sign up: kota agency, nama & jabatan PIC, WA cadangan, sosmed & porto agency (opsional),
   * foto/PDF KTP (Cloudinary), waktu centang pernyataan kewenangan + persetujuan data */
  city?: string
  ownerName?: string
  position?: string
  backupPhone?: string
  consentAt?: Date
  socialMedia?: string
  portfolio?: string
  ktpUrl?: string
  email: string
  phone: string
  password: string
  campaignIds: Types.ObjectId[]
  /** AD-adjustment-6: info rekening/e-wallet diisi admin (lewat kolom edit di Rekap per PIC),
   * nama bank atau jenis e-wallet sama-sama ditaruh di methodName, satu set field generik. */
  paymentInfo?: {
    methodName?: string
    accountNumber?: string
    accountName?: string
    updatedAt?: Date
  }
  /** Balasan WA mentah dari PIC, referensi admin pas isi kolom paymentInfo manual (bukan auto-parse). */
  pendingPaymentReply?: { raw: string; receivedAt: Date }
  /** Kapan admin terakhir minta info bank/e-wallet lewat WA; dipakai cocokkan balasan masuk. */
  paymentInfoRequestedAt?: Date
  /** Campaign yang fee PIC-nya sudah dibayar admin (toggle "Konfirmasi" di Rekap per PIC). */
  paidCampaignIds: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

const PicUserSchema = new Schema<IPicUser>(
  {
    name: { type: String, required: true },
    city: String,
    ownerName: String,
    position: String,
    backupPhone: String,
    consentAt: Date,
    socialMedia: String,
    portfolio: String,
    ktpUrl: String,
    email: { type: String, required: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    campaignIds: [{ type: Schema.Types.ObjectId, ref: 'Campaign' }],
    paymentInfo: {
      methodName: String,
      accountNumber: String,
      accountName: String,
      updatedAt: Date,
    },
    pendingPaymentReply: {
      raw: String,
      receivedAt: Date,
    },
    paymentInfoRequestedAt: Date,
    paidCampaignIds: [{ type: Schema.Types.ObjectId, ref: 'Campaign' }],
  },
  { timestamps: true }
)

withTenant(PicUserSchema)
PicUserSchema.index({ tenantId: 1, email: 1 }, { unique: true })

export default mongoose.model<IPicUser>('PicUser', PicUserSchema)
