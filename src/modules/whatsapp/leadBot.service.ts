import { connectDB } from '../../db/connect'
import { BRAND_JASA_OPTIONS, BrandJasa } from '../../models/Brand'
import { createBrandInquiry } from '../brands/brand.service'
import { sendDirectMessage } from '../../lib/baileys'

/**
 * Bot percakapan WhatsApp untuk lead masuk (belum jadi klien/creator terdaftar) —
 * beda dari trigger AD-30/31 yang mengirim notifikasi ke Creator/Client yang
 * SUDAH ada di sistem. Ini menyapa siapa pun yang chat nomor bisnis, lalu
 * mengarahkan ke salah satu dari 3 jalur: daftar Brand (isi form lewat chat),
 * daftar KOL (redirect ke link form web), atau Support (serah-terima ke admin).
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

type SessionMode = 'menu' | 'brand' | 'support'

interface Session {
  mode: SessionMode
  stepIndex: number
  draft: BrandDraft
  updatedAt: number
}

type ParseResult = { ok: true; value: string } | { ok: false; error: string }

interface BrandStepDef {
  key: keyof BrandDraft
  prompt: string
  parse: (text: string) => ParseResult
}

const BRAND_STEPS: BrandStepDef[] = [
  {
    key: 'fullName',
    prompt: 'Oke, siap bantu daftarkan brand kamu! 🎉\n\nSiapa nama lengkap kamu?',
    parse: (t) => (t.length >= 2 ? { ok: true, value: t } : { ok: false, error: 'Nama minimal 2 karakter ya, coba ketik lagi 🙏' }),
  },
  {
    key: 'whatsapp',
    prompt: 'Nomor WhatsApp yang bisa dihubungi? (boleh beda dari nomor yang kamu pakai chat ini)',
    parse: (t) => {
      const digits = t.replace(/\D/g, '')
      return digits.length >= 9
        ? { ok: true, value: digits }
        : { ok: false, error: 'Nomor WhatsApp sepertinya belum valid, coba ketik lagi ya (contoh: 08xxxxxxxxxx) 🙏' }
    },
  },
  {
    key: 'companyName',
    prompt: 'Nama company / brand kamu apa?',
    parse: (t) => (t.length >= 2 ? { ok: true, value: t } : { ok: false, error: 'Nama company minimal 2 karakter ya 🙏' }),
  },
  {
    key: 'jasa',
    prompt: `Jasa apa yang kamu butuhkan?\n${BRAND_JASA_OPTIONS.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}\n\nBalas dengan angka 1-${BRAND_JASA_OPTIONS.length}.`,
    parse: (t) => {
      const idx = parseInt(t, 10)
      const byIndex = BRAND_JASA_OPTIONS[idx - 1]
      const byLabel = BRAND_JASA_OPTIONS.find((o) => t.toLowerCase().includes(o.label.toLowerCase().split(' ')[0]))
      const match = byIndex || byLabel
      return match ? { ok: true, value: match.key } : { ok: false, error: `Mohon pilih salah satu dengan angka 1-${BRAND_JASA_OPTIONS.length} ya 🙏` }
    },
  },
  {
    key: 'brief',
    prompt: 'Ceritain campaign brief-nya dong — produk apa, campaign-nya ngapain, dll.',
    parse: (t) => (t.length >= 5 ? { ok: true, value: t } : { ok: false, error: 'Boleh diceritain sedikit lebih detail? 🙏' }),
  },
  {
    key: 'targetAudience',
    prompt: 'Target audience campaign kamu seperti apa? (bebas, contoh: wanita 18-30 tahun suka skincare)',
    parse: (t) => (t.length >= 3 ? { ok: true, value: t } : { ok: false, error: 'Boleh dijelaskan sedikit lebih detail? 🙏' }),
  },
  {
    key: 'budget',
    prompt: 'Berapa budget campaign yang disiapkan? (wajib diisi, contoh: Rp 20 juta)',
    parse: (t) =>
      t.length >= 1 && !['-', 'skip', 'tidak ada'].includes(t.toLowerCase())
        ? { ok: true, value: t }
        : { ok: false, error: 'Budget wajib diisi ya kak, mohon isi nominal atau rentang budget-nya 🙏' },
  },
  {
    key: 'timeline',
    prompt: 'Terakhir, timeline campaign-nya kapan? (opsional — ketik "-" kalau belum tahu)',
    parse: (t) => ({
      ok: true,
      value: ['-', 'skip', 'tidak ada', 'belum tahu'].includes(t.toLowerCase()) ? '' : t,
    }),
  },
]

const sessions = new Map<string, Session>()

function newMenuSession(now: number): Session {
  return { mode: 'menu', stepIndex: 0, draft: {}, updatedAt: now }
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
  } else if (session.mode === 'brand') {
    await handleBrandStep(jid, session, text)
  }
}

async function handleMenuChoice(jid: string, session: Session, lower: string): Promise<void> {
  if (lower === '1' || lower.includes('brand')) {
    session.mode = 'brand'
    session.stepIndex = 0
    session.draft = {}
    await sendDirectMessage(jid, BRAND_STEPS[0].prompt)
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

async function handleBrandStep(jid: string, session: Session, text: string): Promise<void> {
  const stepDef = BRAND_STEPS[session.stepIndex]
  const result = stepDef.parse(text)
  if (!result.ok) {
    await sendDirectMessage(jid, result.error)
    return
  }

  ;(session.draft as Record<string, string>)[stepDef.key] = result.value

  const nextIndex = session.stepIndex + 1
  if (nextIndex < BRAND_STEPS.length) {
    session.stepIndex = nextIndex
    await sendDirectMessage(jid, BRAND_STEPS[nextIndex].prompt)
    return
  }

  await finalizeBrandLead(jid, session.draft)
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
