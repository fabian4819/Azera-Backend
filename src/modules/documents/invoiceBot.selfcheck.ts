/**
 * Self-check parser `/invoice` bot WA (format bot-cashflow). Salah parse = invoice klien salah nominal.
 *
 * Jalankan: npx tsx server/src/modules/documents/invoiceBot.selfcheck.ts
 */
import assert from 'node:assert/strict'
import { parseRateInput, parseDiscountInput, parseInvoiceMessage } from './invoiceBot.service'

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

console.log('invoiceBot selfcheck OK')
