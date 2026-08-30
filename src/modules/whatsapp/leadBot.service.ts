import { connectDB } from '../../db/connect'
import { BRAND_JASA_OPTIONS, BRAND_BUDGET_OPTIONS, BrandJasa } from '../../models/Brand'
import { createBrandInquiry } from '../brands/brand.service'
import { sendDirectMessage } from '../../lib/baileys'

/**
 * Bot percakapan WhatsApp untuk lead masuk (belum jadi klien/creator terdaftar) —
 * beda dari trigger AD-30/31 yang mengirim notifikasi ke Creator/Client yang
 * SUDAH ada di sistem. Ini menyapa siapa pun yang chat nomor bisnis, lalu
 * mengarahkan ke salah satu dari 3 jalur: daftar Brand (isi form template
 * sekali kirim), daftar KOL (redirect ke link form web), atau Support
 * (serah-terima ke admin).
 */

const GREETING = 'Halo, kak! 👋 Selamat datang di *AzeraKOL* — agency KOL marketing.'
const MENU =
  'Ada yang bisa kami bantu? Silakan pilih:\n' +
  '1️⃣ Daftar Brand (mau bikin campaign)\n' +
  '2️⃣ Daftar KOL/Creator\n' +
  '3️⃣ Butuh bantuan lain (Support)\n\n' +
  'Balas dengan angka 1, 2, atau 3.'
const KOL_REGISTER_URL = 'https://azerakol.id/kol/register'

const SESSION_TTL_MS = 30 * 60 * 1000 // sesi idle 30 menit → reset ke menu utama
const SUPPORT_SILENCE_MS = 12 * 60 * 60 * 1000 // setelah pilih Support, bot diam 12 jam biar admin yang balas manual

const JASA_LIST = BRAND_JASA_OPTIONS.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
const BUDGET_LIST = BRAND_BUDGET_OPTIONS.map((o, i) => `${i + 1}. ${o.range} — ${o.label}`).join('\n')

// Blok yang dikirim apa adanya supaya bisa langsung di-copy brand, diisi, lalu dikirim balik dalam satu pesan
const BRAND_TEMPLATE_BLOCK =
  'Nama Lengkap: \n' +
  'No. WhatsApp: \n' +
  'Nama Company: \n' +
  `Jasa (isi angka 1-${BRAND_JASA_OPTIONS.length}): \n` +
  'Campaign Brief: \n' +
  'Target Audience: \n' +
  `Budget (isi angka 1-${BRAND_BUDGET_OPTIONS.length}): \n` +
  'Timeline (opsional): '

const BRAND_TEMPLATE_MESSAGE =
  'Oke, siap bantu daftarkan brand kamu! 🎉\n\n' +
  'Tinggal *copy* format di bawah ini, isi bagian setelah titik dua, lalu kirim balik ke chat ini dalam satu pesan ya:\n\n' +
  '```\n' +
  BRAND_TEMPLATE_BLOCK +
  '\n```\n\n' +
  `*Pilihan Jasa:*\n${JASA_LIST}\n\n` +
  `*Pilihan Budget:*\n${BUDGET_LIST}`

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

function newMenuSession(now: number): Session {
  return { mode: 'menu', updatedAt: now }
}

export async function handleIncomingMessage(jid: string, rawText: string): Promise<void> {
  const text = rawText.trim()
  if (!text) return
  const now = Date.now()
  const lower = text.toLowerCase()

  let session = sessions.get(jid)

  // Setelah pilih Support, bot diam total (kecuali user minta "menu") — admin yang ambil alih manual.
  if (session?.mode === 'support' && now - session.updatedAt < SUPPORT_SILENCE_MS && !['menu', 'batal', 'cancel'].includes(lower)) {
    session.updatedAt = now
    return
  }

  if (['menu', 'batal', 'cancel'].includes(lower)) {
    session = newMenuSession(now)
    sessions.set(jid, session)
    await sendDirectMessage(jid, MENU)
    return
  }

  if (!session || now - session.updatedAt > SESSION_TTL_MS) {
    session = newMenuSession(now)
    sessions.set(jid, session)
    await sendDirectMessage(jid, `${GREETING}\n\n${MENU}`)
    return
  }

  session.updatedAt = now

  if (session.mode === 'menu') {
    await handleMenuChoice(jid, session, lower)
  } else if (session.mode === 'brand_template') {
    await handleBrandTemplateReply(jid, text)
  }
}

async function handleMenuChoice(jid: string, session: Session, lower: string): Promise<void> {
  if (lower === '1' || lower.includes('brand')) {
    session.mode = 'brand_template'
    await sendDirectMessage(jid, BRAND_TEMPLATE_MESSAGE)
    return
  }

  if (lower === '2' || lower.includes('kol') || lower.includes('creator') || lower.includes('kreator')) {
    sessions.delete(jid)
    await sendDirectMessage(
      jid,
      `Untuk daftar sebagai KOL/Creator, silakan isi form pendaftaran di link berikut ya:\n\n${KOL_REGISTER_URL}\n\n` +
        'Kalau ada pertanyaan lain, ketik *menu* untuk kembali ke menu utama. 🙌'
    )
    return
  }

  if (lower === '3' || lower.includes('support') || lower.includes('bantuan')) {
    session.mode = 'support'
    await sendDirectMessage(jid, 'Baik kak, mohon ditunggu ya, admin kami akan segera membalas pesan kamu 🙏')
    return
  }

  await sendDirectMessage(jid, `Mohon pilih salah satu ya kak 🙏\n\n${MENU}`)
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

async function handleBrandTemplateReply(jid: string, text: string): Promise<void> {
  const lower = text.toLowerCase()
  if (['format', 'template', 'ulang'].includes(lower)) {
    await sendDirectMessage(jid, BRAND_TEMPLATE_MESSAGE)
    return
  }

  const { draft, missing, invalid, matchedAny } = parseBrandTemplate(text)

  if (!matchedAny) {
    await sendDirectMessage(jid, `Sepertinya belum sesuai format ya kak 🙏 Yuk copy template ini, isi, terus kirim balik:\n\n${BRAND_TEMPLATE_MESSAGE}`)
    return
  }

  if (missing.length > 0 || invalid.length > 0) {
    const lines = ['Beberapa bagian masih perlu dilengkapi/diperbaiki nih kak:']
    missing.forEach((m) => lines.push(`- ${m}: wajib diisi`))
    invalid.forEach((m) => lines.push(`- ${m}`))
    lines.push('', 'Silakan kirim ulang format lengkapnya ya (boleh copy dari pesan kamu sebelumnya lalu diperbaiki). Ketik *format* kalau mau template kosong lagi.')
    await sendDirectMessage(jid, lines.join('\n'))
    return
  }

  await finalizeBrandLead(jid, draft)
  sessions.delete(jid)
}

async function finalizeBrandLead(jid: string, draft: BrandDraft): Promise<void> {
  const jasaLabel = BRAND_JASA_OPTIONS.find((o) => o.key === draft.jasa)?.label || ''

  await connectDB()
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

  const summaryLines = [
    'Sip, sudah kami terima! ✅',
    '',
    '*Ringkasan:*',
    `Nama: ${draft.fullName}`,
    `Company: ${draft.companyName}`,
    `Jasa: ${jasaLabel}`,
    `Budget: ${draft.budget}`,
  ]
  if (draft.timeline) summaryLines.push(`Timeline: ${draft.timeline}`)
  summaryLines.push('', 'Tim kami akan segera menghubungi kamu via WhatsApp untuk follow-up. Terima kasih sudah menghubungi AzeraKOL! 🙏')

  await sendDirectMessage(jid, summaryLines.join('\n'))
}
