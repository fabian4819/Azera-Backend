import { connectDB } from '../../db/connect'
import { BRAND_JASA_OPTIONS, BRAND_BUDGET_OPTIONS, BrandJasa } from '../../models/Brand'
import { createBrandInquiry } from '../brands/brand.service'
import { sendDirectMessage } from '../../lib/baileys'
import { BotId } from './waTemplate.model'
import { hasBotEngaged, markBotEngaged, isBotPaused } from './waChat.service'
import { getLeadBotTemplate } from './leadBotTemplate.service'
import { renderTemplate } from './template.service'

/**
 * Bot percakapan WhatsApp untuk lead masuk (belum jadi klien/creator terdaftar) —
 * beda dari trigger AD-30/31 yang mengirim notifikasi ke Creator/Client yang
 * SUDAH ada di sistem. Ini menyapa nomor yang chat pertama kali ke salah satu bot,
 * lalu kasih 2 pilihan: (1) daftar info Campaign/Brand (bot `partnership`) atau
 * daftar sebagai KOL/Creator (bot `creator`); (2) langsung terhubung ke admin
 * (bot balas "mohon ditunggu" lalu diam, admin ambil alih manual).
 *
 * Bot HANYA merespon di chat pertama nomor tsb (per bot) — `WaContact.botEngaged`
 * ditandai begitu sapaan pertama terkirim. Nomor yang sudah pernah disapa dibiarkan
 * diam permanen kalau mereka chat lagi (sesi TIDAK punya batas waktu — sekali
 * disapa, status "aktif/nonaktif"-nya tetap sampai admin klik "Aktifkan lagi" di
 * Inbox atau server restart). Tidak ada kata kunci reset dari sisi lead.
 *
 * Pengecualian: pesan yang formatnya sudah persis seperti isian template Brand
 * (label field cocok, lihat `parseBrandTemplate`) TETAP diproses apa pun status
 * bot untuk nomor itu (nonaktif/di-pause admin) — supaya kalau admin secara manual
 * minta lead kirim format itu (chat sudah "mati" di sisi bot), pesannya tetap
 * masuk sebagai pendaftaran, bukan cuma nongkrong di Inbox tanpa diproses.
 *
 * Wording pesan (sapaan, menu, dst) diambil dari `LeadBotTemplate` — admin bisa
 * edit lewat `/admin/lead-bot-templates`. Yang TIDAK bisa diadmin-edit (lihat
 * `LOCKED_BRAND_REFERENCE` di bawah): label field template Brand & daftar
 * pilihan Jasa/Budget — parser `parseBrandTemplate` mencocokkan teks-teks itu
 * secara harfiah, jadi mengubahnya lewat DB akan membuat bot gagal baca balasan.
 */

const KOL_REGISTER_URL = 'https://azerakol.id/kol/register'

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

type SessionMode = 'menu' | 'brand_template' | 'support'

interface Session {
  mode: SessionMode
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

/** Dipanggil saat admin klik "Aktifkan lagi" di Inbox — buang state sesi yang nyangkut
 * (mis. masih mode 'support'/'brand_template' lama) supaya chat berikutnya benar-benar mulai dari sapaan. */
export function clearLeadBotSession(bot: BotId, jid: string): void {
  sessions.delete(sessionKey(bot, jid))
}

async function buildMenuMessage(bot: BotId): Promise<string> {
  const tpl = await getLeadBotTemplate('menu')
  const option1 = bot === 'creator' ? 'Daftar sebagai KOL/Creator' : 'Daftar informasi Campaign/Brand'
  return renderTemplate(tpl, { option1 })
}

export async function handleIncomingMessage(bot: BotId, jid: string, rawText: string): Promise<void> {
  const text = rawText.trim()
  if (!text) return
  await connectDB()
  const lower = text.toLowerCase()
  const key = sessionKey(bot, jid)
  const session = sessions.get(key)

  // Pengecualian di atas segalanya: pesan yang sudah berbentuk isian template Brand tetap
  // diproses meski bot nonaktif/di-pause untuk nomor ini — lihat catatan di kepala file.
  if (bot === 'partnership' && parseBrandTemplate(text).matchedAny) {
    sessions.set(key, { mode: 'brand_template' })
    await markBotEngaged(bot, jid)
    await handleBrandTemplateReply(bot, jid, text)
    return
  }

  if (await isBotPaused(bot, jid)) return

  if (!session) {
    // Belum ada percakapan yang sedang berjalan — nomor ini sudah pernah disapa bot
    // sebelumnya? Kalau ya, bot nonaktif untuk nomor ini sampai admin klik "Aktifkan lagi".
    if (await hasBotEngaged(bot, jid)) return

    sessions.set(key, { mode: 'menu' })
    await markBotEngaged(bot, jid)
    const greeting = await getLeadBotTemplate('greeting')
    await sendDirectMessage(bot, jid, `${greeting}\n\n${await buildMenuMessage(bot)}`)
    return
  }

  if (session.mode === 'menu') {
    await handleMenuChoice(bot, jid, session, lower)
  } else if (session.mode === 'brand_template') {
    await handleBrandTemplateReply(bot, jid, text)
  }
  // mode 'support': diam — admin yang balas manual, lihat WhatsAppInbox.
}

async function handleMenuChoice(bot: BotId, jid: string, session: Session, lower: string): Promise<void> {
  const wantsOption1 = lower === '1' || lower.includes('daftar') || lower.includes('campaign') || lower.includes('brand') || lower.includes('kol') || lower.includes('creator') || lower.includes('kreator')
  const wantsOption2 = lower === '2' || lower.includes('admin') || lower.includes('support') || lower.includes('bantuan')

  if (wantsOption1) {
    if (bot === 'creator') {
      sessions.delete(sessionKey(bot, jid))
      const tpl = await getLeadBotTemplate('kol_redirect')
      await sendDirectMessage(bot, jid, renderTemplate(tpl, { link: KOL_REGISTER_URL }))
      return
    }
    session.mode = 'brand_template'
    await sendDirectMessage(bot, jid, await buildBrandTemplateMessage())
    return
  }

  if (wantsOption2) {
    session.mode = 'support'
    await sendDirectMessage(bot, jid, await getLeadBotTemplate('support'))
    return
  }

  await sendDirectMessage(bot, jid, `Mohon pilih salah satu ya kak 🙏\n\n${await buildMenuMessage(bot)}`)
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
