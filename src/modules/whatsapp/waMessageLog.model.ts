import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'
import { WA_TRIGGERS, WaTrigger } from './waTemplate.model'

export type WaMessageStatus = 'queued' | 'sent' | 'failed' | 'skipped'

export interface IWaMessageLog extends Document {
  tenantId: Types.ObjectId
  /** partnership | creator | admin-<userId>-primary|backup (WA admin, lihat lib/baileys.ts) */
  bot: string
  /** Pengirim cadangan kalau kirim lewat `bot` gagal (pengaturan pengirim per campaign) */
  fallbackBot?: string
  trigger: WaTrigger
  to: string
  payload: string
  status: WaMessageStatus
  error?: string
  campaignId?: Types.ObjectId
  creatorId?: Types.ObjectId
  sentAt?: Date
  /** Waktu (terakhir) masuk antrean: kiriman ulang = di-set ulang; batas 24 jam dihitung dari sini */
  queuedAt?: Date
  createdAt: Date
}

const WaMessageLogSchema = new Schema<IWaMessageLog>(
  {
    bot: { type: String, required: true },
    fallbackBot: String,
    trigger: { type: String, enum: WA_TRIGGERS, required: true },
    to: { type: String, required: true },
    payload: { type: String, required: true },
    status: { type: String, enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
    error: String,
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    creatorId: { type: Schema.Types.ObjectId, ref: 'Creator' },
    sentAt: Date,
    queuedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

withTenant(WaMessageLogSchema)
WaMessageLogSchema.index({ tenantId: 1, bot: 1, createdAt: -1 })

export default mongoose.model<IWaMessageLog>('WaMessageLog', WaMessageLogSchema)
