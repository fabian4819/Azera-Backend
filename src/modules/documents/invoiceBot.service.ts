import crypto from 'crypto'
import { connectDB } from '../../db/connect'
import { env } from '../../config/env'
import { renderHtmlToPdf } from '../../lib/pdf'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { nextDocumentNumber, peekInvoiceNumber } from '../finance/invoiceCounter.model'
import DocumentModel from './document.model'
import { renderInvoice, rp } from './docTemplates'

/**
 * Bot invoice WA — port prompt `/invoice` dari bot-cashflow (sudah dipakai tim), tapi hasilnya
 * disimpan sebagai Document invoice di web (template sama dengan menu Document) dan link Drive
 * diganti link preview publik web. Hanya jalan di bot partnership, grup "Invoice Maker" (baileys.ts).
 */

const TZ = 'Asia/Jakarta'
const DUE_DAYS = 7
const round2 = (x: number) => Math.round(x * 100) / 100

interface ParsedItem { name: string; description: string; qty: number | null; rate: number }
export interface ParsedInvoice {
  billTo: string
  campaign: string
  brand?: string
  mastersheetUrl?: string
  discountInput?: string
  /** Isi baris `Biaya:` apa adanya; undefined = tidak ada (default PPH 21 Rp0) */
  chargeInputs?: string[]
  pic?: string
  npwp?: string
  contact?: string
  reference?: string
  dueInput?: string
  items: ParsedItem[]
}

const upperDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).toUpperCase()
/** "YYYY-MM-DD" menurut WIB — format field tanggal di template web */
const isoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000)

/** Angka rupiah: 150000, 150.000, 1,500,000, 3076,92, 3.076,92, 3076.92 — koma/titik + 1-2 digit di akhir = desimal */
function parseAmount(s: string): number | null {
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s) || /^\d+(,\d{1,2})?$/.test(s)) return round2(Number(s.replace(/\./g, '').replace(',', '.')))
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s) || /^\d+(\.\d{1,2})?$/.test(s)) return round2(Number(s.replace(/,/g, '')))
  return null
}

export function parseRateInput(text: string): number | null {
  const s = text.toLowerCase().replace(/\s/g, '').replace(/^rp\.?/, '')
  if (s === '0' || s === 'free' || s === 'gratis') return 0
  const unit = s.match(/^(\d+(?:[.,]\d+)?)(jt|juta|rb|ribu|k)$/)
  if (unit) return round2(Number(unit[1].replace(',', '.')) * (unit[2].startsWith('j') ? 1_000_000 : 1_000))
  return parseAmount(s)
}

export function parseDiscountInput(text: string, subtotal: number): number | null {
  const lower = text.toLowerCase().replace(/\s/g, '')
  if (['0', 'none', 'no', '-'].includes(lower)) return 0
  const percent = lower.match(/^(\d+(?:[.,]\d+)?)(%|persen|percent)$/)
  if (percent) {
    const value = Number(percent[1].replace(',', '.'))
    return value < 0 || value > 100 ? null : round2((subtotal * value) / 100)
  }
  const amount = parseRateInput(text)
  return amount === null || amount < 0 || amount > subtotal ? null : amount
}

/**
 * Baris `Biaya:` → baris di bawah Subtotal Net (template web `charges`). "nama | nominal":
 * nominal format rate (50rb, 3076,92) atau persen dari Subtotal Net (2%); minus = potongan.
 * `Biaya: -` (sendirian) = tanpa baris sama sekali.
 */
export function parseCharges(inputs: string[], subtotal: number): { label: string; amount: number }[] | string {
  if (inputs.length === 1 && inputs[0] === '-') return []
  const out: { label: string; amount: number }[] = []
  for (const input of inputs) {
    const [label, value, ...extra] = input.split('|').map((p) => p.trim())
    if (!label || label === '-' || !value || extra.length) return `❌ Format Biaya salah: "${input}"\nHarus: Biaya: nama | nominal  (mis. \`Biaya: PPH 21 | 50rb\`, \`Biaya: PPh 23 | -2%\`)`
    const sign = value.startsWith('-') ? -1 : 1
    const raw = value.replace(/^[-+]\s*/, '')
    const percent = raw.match(/^(\d+(?:[.,]\d+)?)\s*%$/)
    const amount = percent ? round2((subtotal * Number(percent[1].replace(',', '.'))) / 100) : parseRateInput(raw)
    if (amount === null) return `❌ Nominal Biaya tidak valid: "${value}"\nContoh: 50rb, 1.5jt, 3076,92, 2%, -2%`
    out.push({ label, amount: sign * amount })
  }
  return out
}

/** Due: jumlah hari (14 / 14 hari) atau tanggal (DD/MM/YYYY, YYYY-MM-DD) → "YYYY-MM-DD"; tidak boleh sebelum hari ini */
export function parseDueInput(text: string, now: Date): string | null {
  const s = text.trim().toLowerCase()
  const days = s.match(/^(\d{1,3})\s*(hari|days?)?$/)
  if (days) return isoDate(addDays(now, Number(days[1])))
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  const parts = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null
  if (!parts) return null
  const [y, m, d] = parts
  const date = new Date(Date.UTC(+y, +m - 1, +d))
  if (date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) return null // 31/02 dsb
  const iso = date.toISOString().slice(0, 10)
  return iso < isoDate(now) ? null : iso
}

/** Section `Nama:` sederhana (satu nilai teks) → field ParsedInvoice */
const TEXT_SECTIONS = { pic: /^pic\s*:/i, npwp: /^npwp\s*:/i, contact: /^contact\s*:/i, reference: /^reference\s*:/i, dueInput: /^due\s*:/i } as const

const SECTION_PREFIXES = [/^bill\s+to\s*:/i, /^client\s*:/i, /^campaign\s*:/i, /^brand\s*:/i, /^discount\s*:/i, /^item\s*:/i, /^biaya\s*:/i, ...Object.values(TEXT_SECTIONS)]
const isSectionLine = (line: string) => SECTION_PREFIXES.some((re) => re.test(line))

function parseItems(itemLines: string[]): ParsedItem[] {
  return itemLines.map((line) => {
    const parts = line.replace(/^item\s*:\s*/i, '').trim().split('|').map((p) => p.trim())
    if (parts.length < 4) throw new Error(`Format item salah: "${line}"\nHarus: Item: nama | deskripsi | qty | rate`)
    const [name, description, qtyStr, rateStr] = parts
    let qty: number | null = null
    if (qtyStr !== '-' && qtyStr !== '') {
      qty = parseInt(qtyStr.replace(/\D/g, ''))
      if (isNaN(qty) || qty <= 0) throw new Error(`Qty tidak valid: "${qtyStr}"`)
    }
    const rate = parseRateInput(rateStr)
    if (rate === null) throw new Error(`Rate tidak valid: "${rateStr}"\nContoh: 150000, 150rb, 1.5jt, 3076,92, 0, free`)
    return { name, description, qty, rate }
  })
}

/** Parse isi pesan `/invoice` (baris pertama = perintah). Error → string pesan balasan. */
export function parseInvoiceMessage(body: string): ParsedInvoice | string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean).slice(1)

  const mastersheetIndex = lines.findIndex((line) => line.toLowerCase() === 'mastersheet')
  let mastersheetUrl: string | undefined
  let sectionLines = lines
  if (mastersheetIndex >= 0) {
    sectionLines = lines.slice(0, mastersheetIndex)
    const rest = lines.slice(mastersheetIndex + 1)
    if (rest.length !== 1) return `❌ Setelah "Mastersheet" harus ada tepat 1 link Google Sheets.`
    mastersheetUrl = rest[0].replace(/[,.]+$/, '')
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+(?:\/.*)?$/i.test(mastersheetUrl)) {
      return `❌ Link Mastersheet tidak valid. Gunakan link Google Sheets lengkap.`
    }
  }

  let billTo: string | undefined
  let campaign: string | undefined
  let brand: string | undefined
  let discountInput: string | undefined
  const itemLines: string[] = []
  const chargeLines: string[] = []
  const text: Partial<Record<keyof typeof TEXT_SECTIONS, string>> = {}
  for (const line of sectionLines) {
    const textKey = (Object.keys(TEXT_SECTIONS) as (keyof typeof TEXT_SECTIONS)[]).find((k) => TEXT_SECTIONS[k].test(line))
    if (textKey) { text[textKey] = line.replace(TEXT_SECTIONS[textKey], '').trim(); continue }
    if (/^bill\s+to\s*:/i.test(line)) billTo = line.replace(/^bill\s+to\s*:\s*/i, '').trim()
    else if (/^client\s*:/i.test(line)) billTo = billTo || line.replace(/^client\s*:\s*/i, '').trim()
    else if (/^campaign\s*:/i.test(line)) campaign = line.replace(/^campaign\s*:\s*/i, '').trim()
    else if (/^brand\s*:/i.test(line)) brand = line.replace(/^brand\s*:\s*/i, '').trim()
    else if (/^discount\s*:/i.test(line)) discountInput = line.replace(/^discount\s*:\s*/i, '').trim()
    else if (/^item\s*:/i.test(line)) itemLines.push(line)
    else if (/^biaya\s*:/i.test(line)) chargeLines.push(line.replace(/^biaya\s*:\s*/i, '').trim())
  }

  // Kompatibilitas lama bot-cashflow: 2 baris non-section pertama = klien & campaign, sisanya item
  if ((!billTo || !campaign) && sectionLines.length >= 2) {
    const nonSection = sectionLines.filter((l) => !isSectionLine(l))
    if (nonSection.length >= 2) {
      billTo ||= nonSection[0]
      campaign ||= nonSection[1]
      if (!itemLines.length) itemLines.push(...nonSection.slice(2))
    }
  }

  if (!billTo) return `❌ Gunakan \`Bill To: [nama klien]\` untuk menentukan klien.`
  if (!campaign) return `❌ Gunakan \`Campaign: [nama campaign]\` untuk menentukan campaign.`
  if (!itemLines.length) return `❌ Gunakan \`Item: nama | deskripsi | qty | rate\` untuk menambahkan item.`

  try {
    return { billTo, campaign, brand, mastersheetUrl, discountInput, chargeInputs: chargeLines.length ? chargeLines : undefined, ...text, items: parseItems(itemLines) }
  } catch (err) {
    return (err as Error).message
  }
}

async function invoiceHelp(): Promise<string> {
  const tenant = await getDefaultTenant()
  const nextNo = await peekInvoiceNumber(tenant._id)
  return [
    `🧾 *Buat Invoice — ${nextNo}*`,
    ``,
    `Kirim dalam *1 pesan* dengan format section:`,
    ``,
    '```',
    `/invoice`,
    `Bill To: [nama klien]`,
    `PIC: [nama PIC klien]  (opsional)`,
    `NPWP: [NPWP klien]  (opsional)`,
    `Contact: [telepon / email klien]  (opsional)`,
    `Campaign: [nama campaign]`,
    `Reference: [no. Quotation / SPK]  (opsional)`,
    `Due: [jumlah hari / DD/MM/YYYY]  (opsional)`,
    `Item: [nama] | [deskripsi] | [qty/-] | [rate]`,
    `Item: [nama 2] | [deskripsi] | [qty/-] | [rate]`,
    `Discount: [10% / 150rb]  (opsional)`,
    `Biaya: [nama] | [nominal / %]  (opsional, bisa >1)`,
    ``,
    `Brand: [nama brand]  (opsional)`,
    ``,
    `Mastersheet`,
    `[link Google Sheets]  (opsional)`,
    '```',
    ``,
    `*Contoh:*`,
    '```',
    `/invoice`,
    `Bill To: PT Pintarnya Indonesia`,
    `PIC: Budi Santoso`,
    `NPWP: 01.234.567.8-901.000`,
    `Contact: 0812-3456-7890`,
    `Campaign: Pigeon May`,
    `Reference: QUO/PT-ACN/09/2026/003`,
    `Due: 14`,
    `Brand: Nike`,
    `Item: Pigeon Nano | 1x VT + IG Reels | 17 | 150rb`,
    `Item: Pigeon Micro | 1x VT + IG Reels | - | 150rb`,
    `Discount: 10%`,
    `Biaya: PPH 21 | 50rb`,
    `Biaya: PPh 23 | -2%`,
    ``,
    `Mastersheet`,
    `https://docs.google.com/spreadsheets/d/xxxxxxxx/edit`,
    '```',
    ``,
    'Wajib: `Bill To:`, `Campaign:`, `Item:`. Opsional: `PIC:`, `NPWP:`, `Contact:`, `Reference:`, `Due:`, `Brand:`, `Discount:`, `Biaya:`',
    'Gunakan `-` untuk qty bila tidak perlu jumlah.',
    'Discount bisa persentase atau nominal: `10%`, `150rb`, `1.5jt`.',
    'Biaya = baris di bawah Subtotal Net (pajak, biaya admin, dll). Nominal atau % dari subtotal; minus (`-2%`, `-50rb`) = potongan.',
    'Tanpa `Biaya:` → baris *PPH 21 Rp0*. `Biaya: -` → tanpa baris.',
    'Tanpa `Reference:` → diisi nama campaign (+ brand).',
    `Due date default ${DUE_DAYS} hari: *${upperDate(addDays(new Date(), DUE_DAYS))}*. Ubah dengan \`Due: 14\` atau \`Due: 15/10/2026\`.`,
  ].join('\n')
}

export interface InvoiceBotReply { text: string; pdf?: Buffer; fileName?: string }

/** Pesan grup Invoice Maker → balasan. null = bukan perintah /invoice (diam saja, seperti bot-cashflow). */
export async function handleInvoiceCommand(text: string, source: string): Promise<InvoiceBotReply | null> {
  const trimmed = text.trim()
  const firstLine = trimmed.split('\n')[0].toLowerCase().trim()
  if (firstLine !== '/invoice' && firstLine !== '/inv') return null

  await connectDB()
  if (!trimmed.includes('\n')) return { text: await invoiceHelp() }

  const parsed = parseInvoiceMessage(trimmed)
  if (typeof parsed === 'string') return { text: parsed }

  const subtotal = parsed.items.reduce((s, i) => s + (i.qty ?? 1) * i.rate, 0)
  let discount = 0
  if (parsed.discountInput) {
    const d = parseDiscountInput(parsed.discountInput, subtotal)
    if (d === null) return { text: `❌ Discount tidak valid: "${parsed.discountInput}"\nContoh: 10%, 150rb, 1.5jt. Discount tidak boleh melebihi subtotal.` }
    discount = d
  }
  const charges = parsed.chargeInputs ? parseCharges(parsed.chargeInputs, subtotal) : [{ label: 'PPH 21', amount: 0 }]
  if (typeof charges === 'string') return { text: charges }

  const now = new Date()
  const dueDate = parsed.dueInput ? parseDueInput(parsed.dueInput, now) : isoDate(addDays(now, DUE_DAYS))
  if (!dueDate) return { text: `❌ Due tidak valid: "${parsed.dueInput}"\nContoh: \`Due: 14\` (hari) atau \`Due: 15/10/2026\`. Tidak boleh sebelum hari ini.` }

  const tenant = await getDefaultTenant()
  const number = await nextDocumentNumber(tenant._id, 'invoice', now)
  // Template web tidak punya slot Campaign/Brand → dipakai sebagai REFERENCE kalau `Reference:` tidak diisi
  const data = {
    number,
    issueDate: isoDate(now),
    dueDate,
    reference: parsed.reference || (parsed.brand ? `${parsed.campaign} — ${parsed.brand}` : parsed.campaign),
    billTo: { name: parsed.billTo, pic: parsed.pic, npwp: parsed.npwp, contact: parsed.contact },
    items: parsed.items.map((i) => ({ name: i.name, description: i.description, qty: i.qty ?? '', unitFee: i.rate })),
    discount,
    charges,
    campaign: parsed.campaign,
    brand: parsed.brand,
    mastersheetUrl: parsed.mastersheetUrl,
    source: `wa:${source}`,
  }
  const accessCode = crypto.randomBytes(8).toString('hex')
  const doc = await DocumentModel.create({ tenantId: tenant._id, type: 'invoice', data, accessCode })
  const previewUrl = `${env.clientOrigin}/api/documents/${doc._id}?code=${accessCode}`

  const total = subtotal - discount + charges.reduce((s, c) => s + c.amount, 0)
  const shownCharges = charges.filter((c) => c.amount !== 0)
  const summary = parsed.items.map((i) => `   • ${i.name}: ${i.qty ?? '-'} × ${rp(i.rate)} = ${rp((i.qty ?? 1) * i.rate)}`)
  const reply = [
    `✅ Invoice *${number}*`,
    ``,
    `📋 *${parsed.campaign}*`,
    `👤 ${parsed.billTo}${parsed.pic ? ` (PIC: ${parsed.pic})` : ''}`,
    `📅 Due: ${upperDate(new Date(`${dueDate}T00:00:00+07:00`))}`,
    ...summary,
    ...(discount > 0 || shownCharges.length ? [`Subtotal: ${rp(subtotal)}`] : []),
    ...(discount > 0 ? [`🏷️ Discount: -${rp(discount)}`] : []),
    ...shownCharges.map((c) => (c.amount < 0 ? `➖ ${c.label}: -${rp(-c.amount)}` : `➕ ${c.label}: ${rp(c.amount)}`)),
    `💰 Total: *${rp(total)}*`,
    ``,
    `📎 ${previewUrl}`,
  ].join('\n')

  // PDF gagal (Chromium dsb) tidak membatalkan invoice — dokumen sudah tersimpan, link tetap jalan
  try {
    const { html, pdf } = renderInvoice(data)
    const buffer = await renderHtmlToPdf(html, pdf)
    return { text: reply, pdf: buffer, fileName: `Invoice AZERAKOL.ID_${parsed.campaign}_${number.replace(/\//g, '-')}.pdf` }
  } catch (err) {
    console.error('[InvoiceBot] PDF error:', err)
    return { text: reply }
  }
}
