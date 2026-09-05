import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/**
 * Satu thread percakapan WhatsApp (bukan grup — lihat baileys.ts, pesan grup tidak
 * masuk inbox). botPaused dipakai admin untuk ambil alih chat manual tanpa bentrok
 * sama auto-reply leadBot.service.ts.
 */
export interface IWaContact extends Document {
  tenantId: Types.ObjectId
  jid: string
  name?: string
  botPaused: boolean
  lastMessageAt: Date
  lastMessagePreview: string
  unreadCount: number
  createdAt: Date
  updatedAt: Date
}

const WaContactSchema = new Schema<IWaContact>(
  {
    jid: { type: String, required: true },
    name: String,
    botPaused: { type: Boolean, default: false },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: '' },
    unreadCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)

withTenant(WaContactSchema)
WaContactSchema.index({ tenantId: 1, jid: 1 }, { unique: true })
WaContactSchema.index({ tenantId: 1, lastMessageAt: -1 })

export default mongoose.model<IWaContact>('WaContact', WaContactSchema)
