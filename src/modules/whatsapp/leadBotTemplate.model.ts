import mongoose, { Schema, Document } from 'mongoose'

/**
 * Bagian dari pesan bot lead-intake (leadBot.service.ts) yang boleh diubah admin lewat
 * `/admin/lead-bot-templates`. Sengaja terpisah dari `WaTemplate` (AD-30/31) — itu untuk
 * notifikasi ke Creator/Client yang sudah terdaftar (per-tenant, audience creator|client),
 * ini untuk sapaan ke lead yang belum terdaftar sama sekali (bot global, single-instance,
 * sama seperti `Brand` yang juga tidak tenant-scoped).
 *
 * Bagian yang TIDAK ada di sini (label field template Brand: "Nama Lengkap:", "No. WhatsApp:",
 * dst, serta daftar pilihan Jasa & Budget) sengaja tidak dibuat adjustable — leadBot.service.ts
 * mem-parse balasan lead dengan mencocokkan teks label tersebut secara harfiah (regex), jadi
 * kalau bisa diubah bebas lewat admin, bot bisa gagal total membaca balasan Brand. Bagian ini
 * ditampilkan read-only di UI (lihat `lockedReference` pada GET /admin/lead-bot-templates).
 */
export const LEAD_BOT_TRIGGERS = [
  'greeting',
  'menu',
  'brand_intro',
  'brand_confirmation',
  'kol_redirect',
  'support',
  'brand_incomplete',
  'brand_wrong_format',
] as const

export type LeadBotTrigger = (typeof LEAD_BOT_TRIGGERS)[number]

export interface ILeadBotTemplate extends Document {
  trigger: LeadBotTrigger
  body: string
  createdAt: Date
  updatedAt: Date
}

const LeadBotTemplateSchema = new Schema<ILeadBotTemplate>(
  {
    trigger: { type: String, enum: LEAD_BOT_TRIGGERS, required: true, unique: true },
    body: { type: String, required: true },
  },
  { timestamps: true }
)

export default mongoose.model<ILeadBotTemplate>('LeadBotTemplate', LeadBotTemplateSchema)
