import { connectDB } from '../../db/connect'
import { BRAND_JASA_OPTIONS, BRAND_BUDGET_OPTIONS, BrandJasa } from '../../models/Brand'
import { createBrandInquiry } from '../brands/brand.service'
import { sendDirectMessage } from '../../lib/baileys'
import { BotId } from './waTemplate.model'
import { getLeadBotTemplate } from './leadBotTemplate.service'
import { renderTemplate } from './template.service'

/**
 * Bot percakapan WhatsApp untuk lead masuk (belum jadi klien/creator terdaftar) —
 * beda dari trigger AD-30/31 yang mengirim notifikasi ke Creator/Client yang
 * SUDAH ada di sistem. Ini menyapa siapa pun yang chat nomor bisnis, lalu
 * langsung ke satu jalur tergantung bot mana: bot `partnership` → form daftar
 * Brand (isi template sekali kirim); bot `creator` → redirect ke link form
 * pendaftaran KOL. Keduanya: ketik "support"/"admin" → serah-terima ke admin
 * (bot diam 12 jam). Tidak ada menu 1/2/3 — pemisahan sudah di level nomor.
 *
 * Wording pesan (sapaan, menu, dst) diambil dari `LeadBotTemplate` — admin bisa
 * edit lewat `/admin/lead-bot-templates`. Yang TIDAK bisa diadmin-edit (lihat
 * `LOCKED_BRAND_REFERENCE` di bawah): label field template Brand & daftar
 * pilihan Jasa/Budget — parser `parseBrandTemplate` mencocokkan teks-teks itu
 * secara harfiah, jadi mengubahnya lewat DB akan membuat bot gagal baca balasan.
 */

const KOL_REGISTER_URL = 'https://azerakol.id/kol/register'

const SESSION_TTL_MS = 30 * 60 * 1000 // sesi idle 30 menit → reset ke menu utama
const SUPPORT_SILENCE_MS = 12 * 60 * 60 * 1000 // setelah pilih Support, bot diam 12 jam biar admin yang balas manual

const JASA_LIST = BRAND_JASA_OPTIONS.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
const BUDGET_LIST = BRAND_BUDGET_OPTIONS.map((o, i) => `${i + 1}. ${o.range} — ${o.label}`).join('\n')

// Blok yang dikirim apa adanya supaya bisa langsung di-copy brand, diisi, lalu dikirim balik dalam satu pesan.
// TERKUNCI — bukan bagian dari LeadBotTemplate yang bisa diedit admin, lihat LOCKED_BRAND_REFERENCE.
const BRAND_TEMPLATE_BLOCK =
  'Nama Lengkap: \n' +
  'No. WhatsApp: \n' +
  'Nama Company: \n' +
  `Jasa (isi angka 1-${BRAND_JASA_OPTIONS.length}): \n` +
  'Campaign Brief: \n' +
  'Target Audience: \n' +
  `Budget (isi angka 1-${BRAND_BUDGET_OPTIONS.length}): \n` +
  'Timeline (opsional): '

/** Referensi bagian pesan bot yang TIDAK bisa diubah admin — dipakai `/admin/lead-bot-templates` untuk tampilan read-only */
export const LOCKED_BRAND_REFERENCE = {
  templateBlock: BRAND_TEMPLATE_BLOCK,
  jasaOptions: BRAND_JASA_OPTIONS.map((o, i) => `${i + 1}. ${o.label}`),
  budgetOptions: BRAND_BUDGET_OPTIONS.map((o, i) => `${i + 1}. ${o.range} — ${o.label}`),
}

async function buildBrandTemplateMessage(): Promise<string> {
  const intro = await getLeadBotTemplate('brand_intro')
  return (
    `${intro}\n\n` +
    '```\n' +
    BRAND_TEMPLATE_BLOCK +
    '\n```\n\n' +
    `*Pilihan Jasa:*\n${JASA_LIST}\n\n` +
    `*Pilihan Budget:*\n${BUDGET_LIST}`
  )
}

type BrandDraft = Partial<{
  fullName: string
  whatsapp: string
  companyName: string
  jasa: BrandJasa
  brief: string
  targetAudience: string
  budget: string
  timeline: string
}>

// partnership bot langsung ke alur form Brand; creator bot cuma balas link daftar KOL.
// Tidak ada menu 1/2/3 lagi — tiap nomor bot punya satu tujuan.
type SessionMode = 'brand_template' | 'creator_idle' | 'support'

interface Session {
  mode: SessionMode
  updatedAt: number
}

interface FieldDef {
  key: keyof BrandDraft
  label: string
  match: RegExp
  required: boolean
  hint: string
  /** null = tidak valid/tidak dikenali */
  normalize: (raw: string) => string | null
}

const FIELD_DEFS: FieldDef[] = [
  {
    key: 'fullName',
    label: 'Nama Lengkap',
    match: /^nama\s*lengkap/i,
    required: true,
    hint: 'minimal 2 karakter',
    normalize: (raw) => (raw.trim().length >= 2 ? raw.trim() : null),
  },
  {
    key: 'whatsapp',
    label: 'No. WhatsApp',
    match: /^no\.?\s*whatsapp/i,
    required: true,
    hint: 'nomor WhatsApp yang valid, contoh 08xxxxxxxxxx',
    normalize: (raw) => {
      const digits = raw.replace(/\D/g, '')
      return digits.length >= 9 ? digits : null
    },
  },
  {
    key: 'companyName',
    label: 'Nama Company',
    match: /^nama\s*company/i,
    required: true,
    hint: 'minimal 2 karakter',
    normalize: (raw) => (raw.trim().length >= 2 ? raw.trim() : null),
  },
  {
    key: 'jasa',
    label: 'Jasa',
    match: /^jasa/i,
    required: true,
    hint: `isi angka 1-${BRAND_JASA_OPTIONS.length} sesuai Pilihan Jasa`,
    normalize: (raw) => {
      const t = raw.trim()
      const idx = parseInt(t, 10)
      const byIndex = BRAND_JASA_OPTIONS[idx - 1]
      const byLabel = BRAND_JASA_OPTIONS.find((o) => t.toLowerCase().includes(o.label.toLowerCase()))
      return (byIndex || byLabel)?.key ?? null
    },
  },
  {
    key: 'brief',
    label: 'Campaign Brief',
    match: /^campaign\s*brief/i,
    required: true,
    hint: 'ceritakan sedikit lebih detail',
    normalize: (raw) => (raw.trim().length >= 5 ? raw.trim() : null),
  },
  {
    key: 'targetAudience',
    label: 'Target Audience',
    match: /^target\s*audience/i,
    required: true,
    hint: 'jelaskan sedikit lebih detail',
    normalize: (raw) => (raw.trim().length >= 3 ? raw.trim() : null),
  },
  {
    key: 'budget',
    label: 'Budget',
    match: /^budget/i,
    required: true,
    hint: `isi angka 1-${BRAND_BUDGET_OPTIONS.length} sesuai Pilihan Budget`,
    normalize: (raw) => {
      const t = raw.trim()
      const idx = parseInt(t, 10)
      const byIndex = BRAND_BUDGET_OPTIONS[idx - 1]
      const byRange = BRAND_BUDGET_OPTIONS.find((o) => t.toLowerCase().includes(o.range.toLowerCase()) || t.toLowerCase().includes(o.label.toLowerCase()))
      const match = byIndex || byRange
      return match ? `${match.range} — ${match.label}` : null
    },
  },
  {
    key: 'timeline',
    label: 'Timeline',
    match: /^timeline/i,
    required: false,
    hint: '',
    normalize: (raw) => {
      const t = raw.trim()
      return ['-', 'skip', 'tidak ada', 'belum tahu', ''].includes(t.toLowerCase()) ? '' : t
    },
  },
]

const sessions = new Map<string, Session>()

const sessionKey = (bot: BotId, jid: string) => `${bot}:${jid}`

// Cocok hanya kalau pesan MEMANG cuma kata kunci ini (bukan substring) — supaya isian
// form Brand yang kebetulan memuat "admin"/"support" tidak salah lempar ke mode support.
const SUPPORT_WORDS = ['support', 'admin', 'bantuan', 'butuh bantuan']
const wantsSupport = (lower: string) => SUPPORT_WORDS.includes(lower)

async function enterSupport(bot: BotId, jid: string, now: number): Promise<void> {
  sessions.set(sessionKey(bot, jid), { mode: 'support', updatedAt: now })
  await sendDirectMessage(bot, jid, await getLeadBotTemplate('support'))
}

export async function handleIncomingMessage(bot: BotId, jid: string, rawText: string): Promise<void> {
  const text = rawText.trim()
  if (!text) return
  await connectDB()
  const now = Date.now()
  const lower = text.toLowerCase()
  const key = sessionKey(bot, jid)

  let session = sessions.get(key)

  // Setelah pilih Support, bot diam total (kecuali user ketik menu/batal) — admin yang ambil alih manual.
  if (session?.mode === 'support' && now - session.updatedAt < SUPPORT_SILENCE_MS && !['menu', 'batal', 'cancel'].includes(lower)) {
    session.updatedAt = now
    return
  }

  if (wantsSupport(lower)) {
    await enterSupport(bot, jid, now)
    return
  }

  const expired = !session || now - session.updatedAt > SESSION_TTL_MS
  const reset = ['menu', 'batal', 'cancel', 'mulai', 'start'].includes(lower)

  if (bot === 'creator') {
    // Creator bot: satu tujuan — arahkan ke form pendaftaran KOL. Tidak menampung data lewat chat.
    if (expired || reset || session?.mode !== 'creator_idle') {
      sessions.set(key, { mode: 'creator_idle', updatedAt: now })
      const [greeting, tpl] = await Promise.all([getLeadBotTemplate('greeting'), getLeadBotTemplate('kol_redirect')])
      await sendDirectMessage(bot, jid, `${greeting}\n\n${renderTemplate(tpl, { link: KOL_REGISTER_URL })}`)
    } else {
      session.updatedAt = now
      await sendDirectMessage(bot, jid, renderTemplate(await getLeadBotTemplate('kol_redirect'), { link: KOL_REGISTER_URL }))
    }
    return
  }

  // partnership bot: langsung alur form Brand.
  if (expired || reset) {
    sessions.set(key, { mode: 'brand_template', updatedAt: now })
    const greeting = await getLeadBotTemplate('greeting')
    await sendDirectMessage(bot, jid, `${greeting}\n\n${await buildBrandTemplateMessage()}`)
    return
  }

  session!.updatedAt = now
  if (session!.mode === 'brand_template') {
    await handleBrandTemplateReply(bot, jid, text)
  }
}

/** Cari baris yang jadi awal tiap field, lalu ambil semua teks sampai baris label field berikutnya (dukung isian multi-baris, mis. Campaign Brief panjang) */
function parseBrandTemplate(text: string): { draft: BrandDraft; missing: string[]; invalid: string[]; matchedAny: boolean } {
  const lines = text.split(/\r?\n/)
  const marks: { lineIndex: number; fieldIndex: number; inlineValue: string }[] = []

  lines.forEach((line, lineIndex) => {
    const fieldIndex = FIELD_DEFS.findIndex((f) => f.match.test(line.trim()))
    if (fieldIndex !== -1) {
      const colonIndex = line.indexOf(':')
      marks.push({ lineIndex, fieldIndex, inlineValue: colonIndex !== -1 ? line.slice(colonIndex + 1) : '' })
    }
  })

  const draft: BrandDraft = {}
  const invalid: string[] = []

  marks.forEach((mark, i) => {
    const field = FIELD_DEFS[mark.fieldIndex]
    const nextLineIndex = i + 1 < marks.length ? marks[i + 1].lineIndex : lines.length
    const extraLines = lines.slice(mark.lineIndex + 1, nextLineIndex)
    const raw = [mark.inlineValue, ...extraLines].join('\n').trim()
    const normalized = field.normalize(raw)
    if (normalized === null) {
      invalid.push(`${field.label} (${field.hint})`)
    } else {
      ;(draft as Record<string, string>)[field.key] = normalized
    }
  })

  const attemptedKeys = new Set(marks.map((m) => FIELD_DEFS[m.fieldIndex].key))
  const missing = FIELD_DEFS.filter((f) => f.required && !attemptedKeys.has(f.key)).map((f) => f.label)

  return { draft, missing, invalid, matchedAny: marks.length > 0 }
}

async function handleBrandTemplateReply(bot: BotId, jid: string, text: string): Promise<void> {
  const lower = text.toLowerCase()
  if (['format', 'template', 'ulang'].includes(lower)) {
    await sendDirectMessage(bot, jid, await buildBrandTemplateMessage())
    return
  }

  const { draft, missing, invalid, matchedAny } = parseBrandTemplate(text)

  if (!matchedAny) {
    const intro = await getLeadBotTemplate('brand_wrong_format')
    await sendDirectMessage(bot, jid, `${intro}\n\n${await buildBrandTemplateMessage()}`)
    return
  }

  if (missing.length > 0 || invalid.length > 0) {
    const intro = await getLeadBotTemplate('brand_incomplete')
    const lines = [intro]
    missing.forEach((m) => lines.push(`- ${m}: wajib diisi`))
    invalid.forEach((m) => lines.push(`- ${m}`))
    lines.push('', 'Silakan kirim ulang format lengkapnya ya (boleh copy dari pesan kamu sebelumnya lalu diperbaiki). Ketik *format* kalau mau template kosong lagi.')
    await sendDirectMessage(bot, jid, lines.join('\n'))
    return
  }

  await finalizeBrandLead(bot, jid, draft)
  sessions.delete(sessionKey(bot, jid))
}

async function finalizeBrandLead(bot: BotId, jid: string, draft: BrandDraft): Promise<void> {
  const jasaLabel = BRAND_JASA_OPTIONS.find((o) => o.key === draft.jasa)?.label || ''

  await createBrandInquiry(
    {
      namaBrand: draft.companyName!,
      namaPIC: draft.fullName!,
      whatsapp: draft.whatsapp!,
      targetAudience: draft.targetAudience!,
      budget: draft.budget!,
      durasi: draft.timeline || undefined,
      deskripsi: draft.brief!,
      jasa: draft.jasa,
      source: 'whatsapp',
    },
    `${jasaLabel} — ${draft.companyName}`
  )

  const tpl = await getLeadBotTemplate('brand_confirmation')
  const message = renderTemplate(tpl, {
    fullName: draft.fullName,
    companyName: draft.companyName,
    jasa: jasaLabel,
    budget: draft.budget,
    timelineLine: draft.timeline ? `Timeline: ${draft.timeline}\n` : '',
  })

  await sendDirectMessage(bot, jid, message)
}
