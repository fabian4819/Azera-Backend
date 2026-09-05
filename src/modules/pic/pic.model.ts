import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/**
 * Akun PIC/Handle-by campaign. Beda dari draf awal (hierarki akun per campaign) —
 * satu akun bisa terhubung ke banyak campaign. Sign up TIDAK butuh accessCode —
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
  },
  { timestamps: true }
)

withTenant(PicUserSchema)
PicUserSchema.index({ tenantId: 1, email: 1 }, { unique: true })

export default mongoose.model<IPicUser>('PicUser', PicUserSchema)
