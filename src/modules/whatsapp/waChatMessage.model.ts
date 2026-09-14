import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'
import { BOT_IDS, BotId } from './waTemplate.model'

export type WaChatDirection = 'in' | 'out'

/** Satu pesan dalam percakapan (lihat WaContact untuk thread-nya) — beda dari WaMessageLog
 * yang cuma mencatat pesan keluar hasil trigger otomatis (broadcast/reminder/report). */
export interface IWaChatMessage extends Document {
  tenantId: Types.ObjectId
  bot: BotId
  jid: string
  direction: WaChatDirection
  text: string
  messageId?: string
  /** Nama pengirim DI DALAM grup (jid grup ada di field `jid` di atas) — kosong untuk chat 1:1. */
  senderName?: string
  /** Nomor WA pengirim DI DALAM grup — kosong untuk chat 1:1 (nomornya sudah ada di WaContact.phone). */
  senderPhone?: string
  createdAt: Date
}

const WaChatMessageSchema = new Schema<IWaChatMessage>(
  {
    bot: { type: String, enum: BOT_IDS, required: true },
    jid: { type: String, required: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    text: { type: String, required: true },
    messageId: String,
    senderName: String,
    senderPhone: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

withTenant(WaChatMessageSchema)
WaChatMessageSchema.index({ tenantId: 1, bot: 1, jid: 1, createdAt: 1 })

export default mongoose.model<IWaChatMessage>('WaChatMessage', WaChatMessageSchema)
