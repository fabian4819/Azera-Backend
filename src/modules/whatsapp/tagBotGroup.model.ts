import mongoose, { Schema, Document } from 'mongoose'

/**
 * Grup yang diikuti bot tag (port dari repo bot-tag-whatsapp, sekarang jalan di bot `creator`).
 * Bot keluar otomatis 30 hari setelah masuk grup, kecuali `excluded`. Bukan data per tenant: grup
 * WhatsApp milik nomor bot, bukan milik tenant.
 */
export interface ITagBotGroup extends Document {
  groupId: string
  subject?: string
  joinedAt: Date
  leaveAfterAt: Date
  status: 'active' | 'left'
  /** Tidak ikut auto-leave: grup yang sudah diikuti bot community sebelum fitur tag aktif, atau `!autoleave off` */
  excluded: boolean
  leftAt?: Date
  lastError?: string
}

const TagBotGroupSchema = new Schema<ITagBotGroup>(
  {
    groupId: { type: String, required: true, unique: true },
    subject: String,
    joinedAt: { type: Date, required: true },
    leaveAfterAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'left'], default: 'active' },
    excluded: { type: Boolean, default: false },
    leftAt: Date,
    lastError: String,
  },
  { timestamps: true }
)

export default mongoose.model<ITagBotGroup>('TagBotGroup', TagBotGroupSchema)
