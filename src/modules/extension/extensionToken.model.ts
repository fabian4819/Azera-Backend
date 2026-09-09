import mongoose, { Schema, Document, Types } from 'mongoose'
import crypto from 'crypto'

/**
 * Kode sambungan ekstensi KOL Lister. Analog QR pairing WhatsApp: staf generate
 * kode di halaman "Hubungkan Ekstensi", tempel di popup ekstensi. Setiap request
 * dari ekstensi membawa kode ini di header `X-Azera-Ext-Token`.
 *
 * Yang disimpan hanya hash-nya (sha256) — kode plaintext hanya ditampilkan sekali
 * saat dibuat, persis seperti personal access token.
 */
export interface IExtensionToken extends Document {
  tenantId: Types.ObjectId
  createdByUserId: Types.ObjectId
  label: string
  /** 8 char pertama setelah prefix "AZK1-", untuk identifikasi di daftar token */
  hint: string
  tokenHash: string
  lastUsedAt?: Date
  lastUsedUa?: string
  revokedAt?: Date
  createdAt: Date
  updatedAt: Date
}

/**
 * Sengaja TIDAK pakai withTenant: lookup di `requireExtensionToken` hanya tahu
 * hash token (belum tahu tenant), jadi query by hash saja — guard tenant-plugin
 * akan melempar untuk query tanpa tenantId. tenantId tetap disimpan sebagai field
 * biasa dan selalu ikut difilter di route admin.
 */
const ExtensionTokenSchema = new Schema<IExtensionToken>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, required: true },
    hint: { type: String, required: true },
    tokenHash: { type: String, required: true, index: true },
    lastUsedAt: Date,
    lastUsedUa: String,
    revokedAt: Date,
  },
  { timestamps: true }
)

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/** `AZK1-` + 32 char base32 (Crockford, tanpa I L O U biar tidak ambigu) */
export function generateRawToken(): { raw: string; hint: string } {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const bytes = crypto.randomBytes(32)
  let body = ''
  for (let i = 0; i < 32; i++) body += alphabet[bytes[i] % alphabet.length]
  const raw = `AZK1-${body}`
  return { raw, hint: body.slice(0, 8) }
}

export default mongoose.model<IExtensionToken>('ExtensionToken', ExtensionTokenSchema)
