/**
 * Self-check parser `/invoice` bot WA (format bot-cashflow). Salah parse = invoice klien salah nominal.
 *
 * Jalankan: npx tsx server/src/modules/documents/invoiceBot.selfcheck.ts
 */
import assert from 'node:assert/strict'
import { parseRateInput, parseDiscountInput, parseInvoiceMessage, parseCharges, parseDueInput } from './invoiceBot.service'

// Rate: format lama bot-cashflow tetap sama + desimal (tidak dibulatkan)
assert.equal(parseRateInput('150rb'), 150_000)
assert.equal(parseRateInput('1.5jt'), 1_500_000)
assert.equal(parseRateInput('150000'), 150_000)
assert.equal(parseRateInput('150.000'), 150_000)
assert.equal(parseRateInput('1,500,000'), 1_500_000)
assert.equal(parseRateInput('3076,92'), 3076.92)
assert.equal(parseRateInput('Rp3.076,92'), 3076.92)
assert.equal(parseRateInput('free'), 0)
assert.equal(parseRateInput('abc'), null)

assert.equal(parseDiscountInput('10%', 2_550_000), 255_000)
assert.equal(parseDiscountInput('150rb', 2_550_000), 150_000)
assert.equal(parseDiscountInput('5jt', 2_550_000), null) // melebihi subtotal

const ok = parseInvoiceMessage([
  '/invoice',
  'Bill To: Pintarnya',
  'Campaign: Pigeon May',
  'Brand: Nike',
  'Item: Pigeon Nano | 1x VT + IG Reels | 43 | 3076,92',
  'Item: Pigeon Micro | 1x VT + IG Reels | - | 150rb',
  'Discount: 10%',
  '',
  'Mastersheet',
  'https://docs.google.com/spreadsheets/d/abc123/edit',
].join('\n'))
assert.ok(typeof ok !== 'string', String(ok))
assert.equal(ok.billTo, 'Pintarnya')
assert.equal(ok.campaign, 'Pigeon May')
assert.equal(ok.brand, 'Nike')
assert.equal(ok.discountInput, '10%')
assert.equal(ok.mastersheetUrl, 'https://docs.google.com/spreadsheets/d/abc123/edit')
assert.deepEqual(ok.items.map((i) => [i.qty, i.rate]), [[43, 3076.92], [null, 150_000]])

assert.match(String(parseInvoiceMessage('/invoice\nCampaign: X\nItem: a | b | 1 | 1rb')), /Bill To/)
assert.match(String(parseInvoiceMessage('/invoice\nBill To: A\nCampaign: X\nItem: a | b | 1')), /Format item salah/)

// Biaya: baris di bawah Subtotal Net, nominal, persen dari subtotal, minus = potongan
assert.deepEqual(parseCharges(['PPH 21 | 50rb', 'PPh 23 | -2%', 'Biaya Admin | 3076,92'], 132_307.56), [
  { label: 'PPH 21', amount: 50_000 },
  { label: 'PPh 23', amount: -2646.15 },
  { label: 'Biaya Admin', amount: 3076.92 },
])
assert.deepEqual(parseCharges(['-'], 1000), [])
assert.match(String(parseCharges(['PPH 21'], 1000)), /Format Biaya salah/)
assert.match(String(parseCharges(['PPH 21 | abc'], 1000)), /Nominal Biaya tidak valid/)

const adj = parseInvoiceMessage('/invoice\nBill To: A\nCampaign: X\nItem: a | b | 1 | 1rb\nBiaya: PPH 21 | 50rb\nBiaya: PPh 23 | -2%')
assert.ok(typeof adj !== 'string')
assert.deepEqual(adj.chargeInputs, ['PPH 21 | 50rb', 'PPh 23 | -2%'])
assert.equal((ok as { chargeInputs?: string[] }).chargeInputs, undefined) // tanpa Biaya → default PPH 21 Rp0

// Section teks: PIC / NPWP / Contact / Reference / Due
const full = parseInvoiceMessage('/invoice\nBill To: PT A\nPIC: Budi\nNPWP: 01.234.567.8-901.000\nContact: 0812 / b@a.id\nCampaign: X\nReference: QUO/PT-ACN/09/2026/003\nDue: 14\nItem: a | b | 1 | 1rb')
assert.ok(typeof full !== 'string', String(full))
assert.deepEqual([full.pic, full.npwp, full.contact, full.reference, full.dueInput], ['Budi', '01.234.567.8-901.000', '0812 / b@a.id', 'QUO/PT-ACN/09/2026/003', '14'])
assert.equal(full.billTo, 'PT A') // "Contact:" tidak tertukar dengan "Client:"

const now = new Date('2026-09-29T10:00:00+07:00')
assert.equal(parseDueInput('14', now), '2026-10-13')
assert.equal(parseDueInput('14 hari', now), '2026-10-13')
assert.equal(parseDueInput('15/10/2026', now), '2026-10-15')
assert.equal(parseDueInput('2026-10-15', now), '2026-10-15')
assert.equal(parseDueInput('31/02/2027', now), null) // tanggal tidak ada
assert.equal(parseDueInput('01/09/2026', now), null) // sebelum hari ini
assert.equal(parseDueInput('besok', now), null)

// Mastersheet satu baris "Mastersheet: <link>" (bentuk yang dipakai tim di WA, 30 Sep 2026)
const sheet = 'https://docs.google.com/spreadsheets/d/1Q2hTa-cVml/edit?gid=1642187890#gid=1642187890'
const one = parseInvoiceMessage(`/invoice\nBill To: A\nCampaign: X\nItem: a | b | 1 | 1rb\nBiaya: PPH 21 | 50rb\n\nMastersheet: ${sheet}`)
assert.ok(typeof one !== 'string', String(one))
assert.equal(one.mastersheetUrl, sheet)
assert.deepEqual(one.chargeInputs, ['PPH 21 | 50rb'])
const colonAlone = parseInvoiceMessage(`/invoice\nBill To: A\nCampaign: X\nItem: a | b | 1 | 1rb\nMastersheet:\n${sheet}`)
assert.ok(typeof colonAlone !== 'string' && colonAlone.mastersheetUrl === sheet)
assert.match(String(parseInvoiceMessage('/invoice\nBill To: A\nCampaign: X\nItem: a | b | 1 | 1rb\nMastersheet: https://evil.example/x')), /Mastersheet tidak valid/)

console.log('invoiceBot selfcheck OK')
