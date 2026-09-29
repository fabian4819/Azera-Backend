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

const SECTION_PREFIXES = [/^bill\s+to\s*:/i, /^client\s*:/i, /^campaign\s*:/i, /^brand\s*:/i, /^discount\s*:/i, /^item\s*:/i]
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
  for (const line of sectionLines) {
    if (/^bill\s+to\s*:/i.test(line)) billTo = line.replace(/^bill\s+to\s*:\s*/i, '').trim()
    else if (/^client\s*:/i.test(line)) billTo = billTo || line.replace(/^client\s*:\s*/i, '').trim()
    else if (/^campaign\s*:/i.test(line)) campaign = line.replace(/^campaign\s*:\s*/i, '').trim()
    else if (/^brand\s*:/i.test(line)) brand = line.replace(/^brand\s*:\s*/i, '').trim()
    else if (/^discount\s*:/i.test(line)) discountInput = line.replace(/^discount\s*:\s*/i, '').trim()
    else if (/^item\s*:/i.test(line)) itemLines.push(line)
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
    return { billTo, campaign, brand, mastersheetUrl, discountInput, items: parseItems(itemLines) }
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
    `Campaign: [nama campaign]`,
    `Item: [nama] | [deskripsi] | [qty/-] | [rate]`,
    `Item: [nama 2] | [deskripsi] | [qty/-] | [rate]`,
    `Discount: [10% / 150rb]  (opsional)`,
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
    `Bill To: Pintarnya`,
    `Campaign: Pigeon May`,
    `Brand: Nike`,
    `Item: Pigeon Nano | 1x VT + IG Reels | 17 | 150rb`,
    `Item: Pigeon Micro | 1x VT + IG Reels | - | 150rb`,
    `Discount: 10%`,
    ``,
    `Mastersheet`,
    `https://docs.google.com/spreadsheets/d/xxxxxxxx/edit`,
    '```',
    ``,
    'Section yang tersedia: `Bill To:`, `Campaign:`, `Brand:`, `Discount:`, `Item:`',
    'Gunakan `-` untuk qty bila tidak perlu jumlah.',
    'Discount bisa persentase atau nominal: `10%`, `150rb`, `1.5jt`.',
    `Due date otomatis *${upperDate(addDays(new Date(), DUE_DAYS))}*`,
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

  const tenant = await getDefaultTenant()
  const now = new Date()
  const number = await nextDocumentNumber(tenant._id, 'invoice', now)
  // Template web tidak punya slot Campaign/Brand → dipakai sebagai REFERENCE (bisa diedit di menu Document)
  const data = {
    number,
    issueDate: isoDate(now),
    dueDate: isoDate(addDays(now, DUE_DAYS)),
    reference: parsed.brand ? `${parsed.campaign} — ${parsed.brand}` : parsed.campaign,
    billTo: { name: parsed.billTo },
    items: parsed.items.map((i) => ({ name: i.name, description: i.description, qty: i.qty ?? '', unitFee: i.rate })),
    discount,
    campaign: parsed.campaign,
    brand: parsed.brand,
    mastersheetUrl: parsed.mastersheetUrl,
    source: `wa:${source}`,
  }
  const accessCode = crypto.randomBytes(8).toString('hex')
  const doc = await DocumentModel.create({ tenantId: tenant._id, type: 'invoice', data, accessCode })
  const previewUrl = `${env.clientOrigin}/api/documents/${doc._id}?code=${accessCode}`

  const total = subtotal - discount
  const summary = parsed.items.map((i) => `   • ${i.name}: ${i.qty ?? '-'} × ${rp(i.rate)} = ${rp((i.qty ?? 1) * i.rate)}`)
  const reply = [
    `✅ Invoice *${number}*`,
    ``,
    `📋 *${parsed.campaign}*`,
    `👤 ${parsed.billTo}`,
    ...summary,
    ...(discount > 0 ? [`Subtotal: ${rp(subtotal)}`, `🏷️ Discount: -${rp(discount)}`] : []),
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
