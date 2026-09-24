import fs from 'fs'
import path from 'path'
import { PdfOptions } from '../../lib/pdf'
import { SPK_INTRO, SPK_PASAL, QUOTATION_TERMS } from './templateText'

/**
 * Template Quotation / Invoice / SPK — dibuat ulang dari Google Docs klien (24 Sep 2026).
 * Semua isian user WAJIB lewat esc(): HTML ini dirender Chromium (lib/pdf.ts).
 */

const ASSETS = path.join(__dirname, '../../../assets/documents')
const dataUri = (file: string) => `data:image/png;base64,${fs.readFileSync(path.join(ASSETS, file)).toString('base64')}`
let logoCache: { full: string; mark: string } | null = null
function logos() {
  if (!logoCache) logoCache = { full: dataUri('logo.png'), mark: dataUri('logo-mark.png') }
  return logoCache
}

const COMPANY = {
  name: 'PT Azera Creator Network',
  address: 'Gedung Sovoism, Jl. Dr. Cipto No. 20, RT 000/RW 000, Bugangan, Semarang Timur, Kota Semarang, Jawa Tengah',
  npwp: '1000000010776698',
  email: 'partnership@azerakol.id',
  whatsapp: '+62 819-1952-5186',
  director: 'Azzaitun Nur Rachma',
  bank: 'BCA',
  bankLong: 'Bank Central Asia (BCA)',
  accountNo: '0093106544',
}

type Data = Record<string, unknown>

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
/** Teks isian: kosong → "-" (template: bagian tidak berlaku tidak boleh dibiarkan kosong) */
const t = (v: unknown, empty = '-') => (String(v ?? '').trim() ? esc(v).replace(/\n/g, '<br>') : empty)
const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
export const rp = (v: unknown) => `Rp${Math.round(n(v)).toLocaleString('id-ID')}`
const obj = (v: unknown): Data => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : {})
const arr = (v: unknown): Data[] => (Array.isArray(v) ? v.map(obj) : [])

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

function parseDate(v: unknown): Date | null {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
}
/** "2026-09-24" → "24 September 2026" (UTC, supaya tidak geser hari) */
export function dateID(v: unknown): string {
  const d = parseDate(v)
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : t(v)
}

type Item = Data & { qtyN: number; fee: number; amount: number }
function items(v: unknown): Item[] {
  return arr(v)
    .filter((i) => String(i.name ?? '').trim())
    .map((i) => {
      const qtyN = i.qty === '' || i.qty === undefined || i.qty === null ? 1 : n(i.qty)
      const fee = n(i.unitFee)
      return { ...i, qtyN, fee, amount: qtyN * fee }
    })
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', 'FreeSerif', 'Liberation Serif', serif; font-size: 10pt; line-height: 1.35; -webkit-print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; }
  .pb { break-before: page; }
  .nobreak { break-inside: avoid; }
`

const simpleFooter = (color: string) => `
  <div style="width:100%;font-family:'Times New Roman',serif;font-size:7.5pt;color:${color};padding:0 18mm;display:flex;justify-content:space-between;">
    <span style="border-top:1px solid #dcd6f5;padding-top:4px;flex:1;display:flex;justify-content:space-between;">
      <span>${COMPANY.email} &nbsp;|&nbsp; azerakol.id</span><b>${COMPANY.name}</b>
    </span>
  </div>`

function letterhead(color: string, muted: string, title: string, titleBox: string) {
  return `
  <div style="display:flex;align-items:center;gap:14px;">
    <img src="${logos().full}" style="width:66px;height:66px;">
    <div style="flex:1;">
      <div style="font-size:19pt;font-weight:bold;color:${color};line-height:1.1;">AZERAKOL.ID <span style="font-size:10pt;">| ${COMPANY.name}</span></div>
      <div style="font-size:7.5pt;color:${muted};margin-top:4px;max-width:360px;">${COMPANY.address}</div>
    </div>
    <div style="${titleBox}">${title}</div>
  </div>`
}

/* ------------------------------------------------------------------ INVOICE */

export function renderInvoice(d: Data): { html: string; pdf: PdfOptions } {
  const P = '#4b2fc4', L = '#f1eeff', LL = '#f8f7fc', M = '#666375', INK = '#111111'
  const bill = obj(d.billTo)
  const rows = items(d.items)
  const subtotal = rows.reduce((s, i) => s + i.amount, 0)
  const discount = Math.min(n(d.discount), subtotal)
  const total = subtotal - discount

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    body { color: ${INK}; }
    h3 { color: ${P}; font-size: 10pt; margin: 14px 0 6px; }
    .meta td { background: ${L}; padding: 8px 9px; width: 25%; vertical-align: top; border-right: 6px solid #fff; }
    .meta small, .lbl { display: block; font-size: 7.5pt; font-weight: bold; color: ${M}; }
    .meta b { font-size: 9pt; white-space: nowrap; }
    .box { border: 1px solid #d9d3f7; }
    .box td { padding: 10px; vertical-align: top; width: 50%; font-size: 8pt; color: ${M}; }
    .box .who { font-size: 12pt; font-weight: bold; color: ${INK}; margin: 2px 0 3px; }
    .box .h { font-size: 8.5pt; font-weight: bold; color: ${P}; }
    .it th { background: ${P}; color: #fff; padding: 7px; font-size: 8.5pt; }
    .it td { border: 1px solid #d9d3f7; padding: 7px; text-align: center; font-size: 9pt; }
    .it td.d { text-align: left; }
    .it td.d small { display: block; color: ${M}; font-size: 8pt; }
    .tot td { border: 1px solid #d9d3f7; padding: 7px 9px; }
    .tot .grand td { background: ${P}; color: #fff; font-weight: bold; }
    .notes { font-size: 7.5pt; color: ${M}; }
    .pay td { border: 1px solid #d9d3f7; padding: 6px 9px; font-size: 9pt; }
    .pay td.k { background: ${LL}; color: ${M}; font-size: 7.5pt; font-weight: bold; width: 45%; }
  </style></head><body>
    ${letterhead(P, M, 'INVOICE', `background:${P};color:#fff;font-size:17pt;font-weight:bold;width:210px;height:74px;display:flex;align-items:center;justify-content:center;`)}

    <table class="meta" style="margin-top:14px;"><tr>
      <td><small>INVOICE NO.</small><b>${t(d.number)}</b></td>
      <td><small>ISSUED DATE</small><b>${dateID(d.issueDate)}</b></td>
      <td><small>DUE DATE</small><b>${dateID(d.dueDate)}</b></td>
      <td><small>REFERENCE</small><b>${t(d.reference)}</b></td>
    </tr></table>

    <h3>COMPANY INFORMATION</h3>
    <table class="box"><tr>
      <td style="background:${L};border-right:1px solid #d9d3f7;">
        <div class="h">FROM</div><div class="who">${COMPANY.name}</div>
        <b>NPWP:</b> ${COMPANY.npwp}<br><b>Email:</b> ${COMPANY.email}<br><b>WhatsApp:</b> ${COMPANY.whatsapp}
      </td>
      <td>
        <div class="h">BILL TO</div><div class="who">${t(bill.name)}</div>
        <b>PIC:</b> ${t(bill.pic, '')}<br><b>NPWP:</b> ${t(bill.npwp, '')}<br><b>Contact:</b> ${t(bill.contact, '')}
      </td>
    </tr></table>

    <h3>INVOICE DETAILS</h3>
    <table class="it">
      <tr><th style="width:7%">No.</th><th>Service / Description</th><th style="width:11%">Qty</th><th style="width:15%">Unit Fee</th><th style="width:17%">Amount</th></tr>
      ${rows.map((i, k) => `<tr><td>${k + 1}</td><td class="d"><b>${t(i.name)}</b>${String(i.description ?? '').trim() ? `<small>${t(i.description)}</small>` : ''}</td><td>${i.qtyN}</td><td>${rp(i.fee)}</td><td>${rp(i.amount)}</td></tr>`).join('')}
    </table>

    <table class="tot" style="margin-top:12px;">
      <tr><td>Subtotal Net</td><td style="text-align:right;font-weight:bold;">${rp(subtotal)}</td></tr>
      ${discount > 0 ? `<tr><td>Discount</td><td style="text-align:right;font-weight:bold;">- ${rp(discount)}</td></tr>` : ''}
      <tr class="grand"><td style="width:45%">TOTAL INVOICE</td><td style="text-align:right;font-size:14pt;">${rp(total)}</td></tr>
    </table>

    <h3>NOTES</h3>
    <div class="notes">
      • Pembayaran dilakukan paling lambat sesuai Due Date yang tertera.<br>
      • Cantumkan nomor invoice pada berita transfer dan kirim bukti pembayaran ke ${COMPANY.email}.<br>
      • ${COMPANY.name} merupakan perusahaan non-PKP, sehingga PPN tidak dipungut.<br>
      • ${COMPANY.name} merupakan PT Perorangan sehingga PPh tidak dipungut, melainkan disetor sendiri.<br>
      • Invoice ini sah tanpa tanda tangan sebagai dokumen yang dibuat secara elektronik, kecuali klien mensyaratkan tanda tangan atau e-Meterai.
    </div>

    <div class="nobreak" style="display:flex;gap:26px;margin-top:20px;align-items:flex-start;">
      <div style="flex:1;">
        <h3 style="margin-top:0;">PAYMENT INFORMATION</h3>
        <table class="pay">
          <tr><td class="k">BANK</td><td><b>${COMPANY.bank}</b></td></tr>
          <tr><td class="k">ACCOUNT NO.</td><td><b style="color:${P}">${COMPANY.accountNo}</b></td></tr>
          <tr><td class="k">ACCOUNT NAME</td><td><b>${COMPANY.name}</b></td></tr>
        </table>
      </div>
      <div style="flex:1;border:1px solid #d9d3f7;background:${LL};text-align:center;padding:10px;height:134px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="color:${P};font-weight:bold;font-size:8.5pt;">AUTHORIZED BY</div>
        <div><b>${COMPANY.director}</b><div style="font-size:8pt;color:${M};">${COMPANY.name}</div></div>
      </div>
    </div>
  </body></html>`

  return { html, pdf: { footerTemplate: simpleFooter(M), headerTemplate: '<span></span>', margin: { top: '16mm', right: '18mm', bottom: '18mm', left: '18mm' } } }
}

/* ---------------------------------------------------------------- QUOTATION */

export function renderQuotation(d: Data): { html: string; pdf: PdfOptions } {
  const P = '#4930b8', L = '#f3f0ff', LL = '#faf9fd', M = '#666674', INK = '#1c1c24'
  const c = obj(d.client)
  const cp = obj(d.campaign)
  const ap = obj(d.approval)
  const rows = items(d.items)
  const total = rows.reduce((s, i) => s + i.amount, 0)
  const bullet = (label: string, v: unknown) => `<div>➢&nbsp;&nbsp; ${label}: ${t(v)}</div>`
  const pic = [c.picName, c.picPosition, c.picContact].map((v) => t(v)).join(' | ')

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    body { color: ${INK}; }
    h3 { color: ${P}; font-size: 8.5pt; margin: 12px 0 5px; }
    .meta td { background: ${L}; padding: 6px 9px; font-size: 9pt; border-bottom: 3px solid #fff; }
    .meta td.k { color: ${M}; font-size: 7.5pt; font-weight: bold; width: 17%; }
    .info td { border: 1px solid #000; padding: 7px 9px; font-size: 10pt; vertical-align: middle; }
    .info td.k { background: ${LL}; color: ${M}; font-size: 7.5pt; font-weight: bold; width: 32%; }
    .it th { background: ${P}; color: #fff; padding: 7px; font-size: 8pt; }
    .it td { border: 1px solid #dcd6f5; padding: 8px; text-align: center; font-size: 9pt; }
    .it td.d { text-align: left; }
    .terms { border: 1px solid #dcd6f5; display: flex; }
    .terms > div { flex: 1; padding: 8px 10px; font-size: 7.6pt; }
    .terms > div + div { border-left: 1px solid #dcd6f5; }
    .terms p { margin-bottom: 5px; }
    .terms b.n { color: ${P}; }
    .sign { display: flex; border: 1px solid #dcd6f5; background: ${LL}; }
    .sign > div { flex: 1; padding: 10px; height: 130px; display: flex; flex-direction: column; justify-content: space-between; font-size: 9pt; }
    .sign > div + div { border-left: 1px solid #dcd6f5; }
    .sign .h { color: ${P}; font-weight: bold; font-size: 7.5pt; }
    .sign .s { color: ${M}; }
  </style></head><body>
    ${letterhead(P, M, 'QUOTATION', `background:${P};color:#fff;font-size:15pt;font-weight:bold;padding:2px 6px;align-self:flex-start;`)}

    <div style="font-size:24pt;font-weight:bold;margin-top:20px;">KOL Campaign Quotation</div>
    <div style="color:${M};font-size:9pt;margin-bottom:8px;">Penawaran resmi untuk pelaksanaan campaign berdasarkan ruang lingkup dan ketentuan berikut.</div>
    <table class="meta">
      <tr><td class="k">QUOTATION NO.</td><td><b>${t(d.number)}</b></td><td class="k">ISSUED DATE</td><td><b>${dateID(d.issueDate)}</b></td></tr>
      <tr><td class="k">VALID UNTIL</td><td><b>${dateID(d.validUntil)}</b></td><td class="k">PREPARED BY</td><td>Business Development | <b>azerakol.id</b></td></tr>
    </table>

    <h3>CLIENT INFORMATION</h3>
    <table class="info">
      <tr><td class="k">COMPANY / BRAND</td><td>${t(c.company)}</td></tr>
      <tr><td class="k">ADDRESS</td><td>${t(c.address)}</td></tr>
      <tr><td class="k">PIC</td><td>${pic}</td></tr>
      <tr><td class="k">TAX INFORMATION</td><td>${t(c.tax)}</td></tr>
    </table>

    <h3>CAMPAIGN INFORMATION</h3>
    <table class="info">
      <tr><td class="k">CAMPAIGN</td><td>${t(cp.name)}</td></tr>
      <tr><td class="k">PERIOD</td><td>${bullet('Campaign period', cp.period)}${bullet('Expected posting date', cp.postingDate)}</td></tr>
      <tr><td class="k">CREATOR CRITERIA</td><td>${bullet('Tier Followers', cp.tier)}${bullet('Platform', cp.platform)}${bullet('Niche', cp.niche)}${bullet('Demographic', cp.demographic)}</td></tr>
      <tr><td class="k">APPROVAL</td><td>Pemilihan final KOL akan dikonfirmasi melalui approval sheet yang telah disepakati.</td></tr>
    </table>

    <h3>SCOPE OF WORK AND INVESTMENT</h3>
    <table class="it">
      <tr><th style="width:11%">No.</th><th>Service / Deliverables</th><th style="width:12%">Qty</th><th style="width:15%">Net Unit Fee</th><th style="width:15%">Net Amount</th></tr>
      ${rows.map((i, k) => `<tr><td>${k + 1}</td><td class="d"><b>${t(i.name)}</b>${String(i.sow ?? '').trim() ? `<br>SOW: ${t(i.sow)}` : ''}</td><td>${i.qtyN}</td><td>${rp(i.fee)}</td><td>${rp(i.amount)}</td></tr>`).join('')}
    </table>
    <table style="width:60%;margin-top:4px;">
      <tr><td style="color:${M};font-size:8pt;padding:4px 8px;">Subtotal Net Campaign Fee</td><td style="text-align:right;font-weight:bold;padding:4px 8px;">${rp(total)}</td></tr>
      <tr style="background:${P};color:#fff;font-weight:bold;"><td style="padding:8px;font-size:9pt;">TOTAL NET CAMPAIGN FEE</td><td style="text-align:right;padding:8px;font-size:14pt;">${rp(total)}</td></tr>
    </table>
    <p style="font-size:7.8pt;color:${M};margin-top:8px;text-align:justify;"><b style="color:${P}">Catatan Pajak.</b> ${QUOTATION_TERMS.find((x) => x.title === 'Pajak')?.text ?? ''}</p>

    <div class="pb"></div>
    <div style="font-size:14pt;font-weight:bold;">Terms and Conditions</div>
    <div style="color:${M};font-size:9pt;margin:4px 0 8px;">Ketentuan ini merupakan bagian yang tidak terpisahkan dari quotation dan mulai berlaku setelah quotation disetujui serta ditandatangani.</div>
    <div class="terms">
      ${[QUOTATION_TERMS.slice(0, 7), QUOTATION_TERMS.slice(7)].map((col, ci) => `<div>${col.map((x, k) => `<p><b class="n">${ci * 7 + k + 1}.</b> <b>${esc(x.title)}.</b> ${esc(x.text)}</p>`).join('')}</div>`).join('')}
    </div>

    <div class="nobreak">
      <div style="font-size:14pt;font-weight:bold;margin-top:14px;">Approval</div>
      <div style="color:${M};font-size:9pt;margin:4px 0 8px;">Dengan menandatangani bagian di bawah ini, kedua pihak menyatakan telah membaca, memahami, dan menyetujui quotation ini beserta seluruh ketentuannya.</div>
      <div class="sign">
        <div><span class="h">PROPOSED BY</span><div><b>${COMPANY.director}</b><div class="s">${COMPANY.name}</div><div class="s">${String(ap.proposedDate ?? '').trim() ? dateID(ap.proposedDate) : '&nbsp;'}</div></div></div>
        <div><span class="h">APPROVED BY</span><div><b>${t(ap.approverName, '&nbsp;')}</b><div class="s">${t(ap.approverCompany ?? c.company, '&nbsp;')}</div><div class="s">${String(ap.approvedDate ?? '').trim() ? dateID(ap.approvedDate) : '&nbsp;'}</div></div></div>
      </div>
    </div>
  </body></html>`

  return { html, pdf: { footerTemplate: simpleFooter(M), headerTemplate: '<span></span>', margin: { top: '16mm', right: '16mm', bottom: '18mm', left: '16mm' } } }
}

/* ---------------------------------------------------------------------- SPK */

export function renderSpk(d: Data): { html: string; pdf: PdfOptions } {
  const P = '#6f2c91', D = '#43205c', L = '#f3ebf7', INK = '#25212a', M = '#6c6670'
  const c = obj(d.client)
  const l1 = obj(d.lampiran1)
  const r = obj(d.rights)
  const l2 = obj(d.lampiran2)
  const sd = parseDate(d.signDate)
  const clientName = t(c.company, '[NAMA BADAN USAHA KLIEN]')

  const kv = (rows: [string, string][], head: [string, string], headColor = P) => `
    <table class="kv">
      <tr><th style="background:${headColor}">${head[0]}</th><th style="background:${headColor}">${head[1]}</th></tr>
      ${rows.map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('')}
    </table>`
  const party = (title: string, color: string, rows: [string, string][]) => `
    <div class="nobreak" style="margin-top:12px;">
      <div style="background:${color};color:#fff;font-weight:bold;font-size:9pt;padding:3px 0;">${title}</div>
      <table class="kv">${rows.map(([k, v]) => `<tr><td class="k" style="width:27%">${k}</td><td>${v}</td></tr>`).join('')}</table>
    </div>`
  const right = (key: string, extra: (x: Data) => string) => {
    const x = obj(r[key])
    return x.enabled === true || x.enabled === 'YA' ? `YA${extra(x)}` : 'TIDAK'
  }
  const mechanism = l1.mechanism === 'tanpa' ? 'TANPA APPROVAL INDIVIDUAL KLIEN' : 'DENGAN APPROVAL KLIEN'
  const fullListingApproval = l1.mechanism === 'tanpa'
    ? 'Tidak berlaku karena menggunakan mekanisme tanpa approval individual'
    : 'Maksimal 3 (tiga) Hari Kerja'
  const termin = (x: Data) => `${t(x.percent)}% / ${rp(x.amount)} - jatuh tempo ${String(x.due ?? '').match(/^\d{4}-/) ? dateID(x.due) : t(x.due)}`
  const biayaTambahan = n(l2.additionalFee) > 0 ? rp(l2.additionalFee) : 'Tidak Ada'
  const totalTagihan = n(l2.serviceFee) + n(l2.additionalFee)

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    body { color: ${INK}; font-size: 10.5pt; line-height: 1.6; }
    .c { text-align: center; }
    p.j { text-align: justify; margin-top: 8px; }
    .kv td, .kv th { border: 1px solid #000; padding: 6px 8px; font-size: 9pt; text-align: left; vertical-align: top; line-height: 1.4; }
    .kv th { color: #fff; font-size: 8pt; }
    .kv td.k { background: ${L}; color: ${D}; font-weight: bold; width: 35%; }
    .pasal { margin-top: 14px; }
    .pasal h4 { background: ${L}; border-left: 3px solid ${P}; color: ${D}; font-size: 10pt; padding: 3px 10px; margin-bottom: 6px; break-after: avoid; }
    .pasal ol { list-style: none; padding-left: 28px; }
    .pasal li { position: relative; text-align: justify; margin-bottom: 5px; }
    .pasal li > span.num { position: absolute; left: -28px; }
    .pasal li p { margin-top: 5px; }
    .lamp { color: ${P}; font-size: 13pt; font-weight: bold; }
    .hl { background: #fff2cc; }
  </style></head><body>
    <div class="c" style="color:${D};font-size:18pt;font-weight:bold;">PERJANJIAN KERJA SAMA</div>
    <div class="c" style="color:${P};font-size:13pt;font-weight:bold;">JASA KOL MANAGEMENT</div>
    <div class="c" style="color:${M};font-weight:bold;font-size:10pt;">Nomor: ${t(d.number)}</div>

    <p class="j" style="margin-top:16px;">Pada hari ini, ${sd ? DAYS[sd.getUTCDay()] : '-'}, tanggal ${sd ? sd.getUTCDate() : '-'} bulan ${sd ? MONTHS[sd.getUTCMonth()] : '-'} tahun ${sd ? sd.getUTCFullYear() : '-'}, Para Pihak yang bertanda tangan di bawah ini menerangkan dan menyepakati hal-hal sebagai berikut:</p>

    ${party('PIHAK PERTAMA', P, [['Nama Perusahaan', 'PT AZERA CREATOR NETWORK'], ['Diwakili oleh', COMPANY.director], ['Jabatan', 'Direktur'], ['Alamat', 'Gedung Sovoism, Jl. Dr. Cipto No. 20, Bugangan, Semarang Timur, Kota Semarang'], ['NPWP', COMPANY.npwp]])}
    <p class="j" style="margin-top:4px;">Dalam hal ini bertindak secara sah untuk dan atas nama ${COMPANY.name}, selanjutnya disebut PIHAK PERTAMA.</p>
    ${party('PIHAK KEDUA', D, [['Nama Perusahaan', clientName], ['Diwakili oleh', t(c.signer)], ['Jabatan', t(c.position)], ['Alamat', t(c.address)], ['NPWP', t(c.npwp)]])}
    <p class="j" style="margin-top:4px;">Dalam hal ini bertindak secara sah untuk dan atas nama ${clientName}, selanjutnya disebut PIHAK KEDUA.</p>
    ${SPK_INTRO.map((x) => `<p class="j">${esc(x)}</p>`).join('')}

    ${SPK_PASAL.map((ps, pi) => `
      <div class="pasal">
        <h4>PASAL ${pi + 1} &nbsp;|&nbsp; ${esc(ps.title)}</h4>
        <ol>${ps.items.map((it, ii) => `<li><span class="num">(${ii + 1})</span>${esc(it.text)}${it.subs.map((s) => `<p>${esc(s).replace(/^([ab]\.) (.+?),/, '$1 <b>$2</b>,')}</p>`).join('')}</li>`).join('')}</ol>
      </div>`).join('')}

    <div class="nobreak" style="margin-top:18px;">
      <div class="c" style="color:${D};font-weight:bold;">${t(d.city, '[KOTA]')}, ${sd ? dateID(d.signDate) : '[TANGGAL PENANDATANGANAN]'}</div>
      <table style="margin-top:14px;text-align:center;color:${D};font-weight:bold;font-size:10pt;">
        <tr><td style="width:50%">PIHAK PERTAMA</td><td>PIHAK KEDUA</td></tr>
        <tr><td>PT AZERA CREATOR NETWORK</td><td>${clientName}</td></tr>
        <tr><td style="height:110px;"></td><td></td></tr>
        <tr><td style="color:${INK}">${COMPANY.director}<br>Direktur</td><td style="color:${INK}">${t(c.signer)}<br>${t(c.position)}</td></tr>
      </table>
    </div>

    <div class="pb"></div>
    <div class="c lamp">LAMPIRAN 1</div>
    <div class="c" style="color:${D};font-weight:bold;margin-bottom:12px;">DETAIL CAMPAIGN DAN RUANG LINGKUP</div>
    ${kv([
      ['Nama Campaign', t(l1.campaignName)],
      ['Brand/Produk', t(l1.brandProduct)],
      ['Periode', `${dateID(l1.periodStart)} s.d. ${dateID(l1.periodEnd)}`],
      ['Platform', t(l1.platform)],
      ['Target KOL', t(l1.targetKol)],
      ['Referensi Sample List', t(l1.sampleList)],
      ['Status Sample', `Telah disetujui melalui ${t(l1.sampleApprovedVia)} pada ${dateID(l1.sampleApprovedDate)}`],
      ['Mekanisme Pemilihan Full Listing', mechanism],
      ['Approval Full Listing', fullListingApproval],
      ['Approval Draft Materi Konten', 'Maksimal 3 (tiga) Hari Kerja sejak materi diterima'],
      ['Deliverables', t(l1.deliverables)],
      ['Aktivitas Tambahan', t(l1.extraActivities, 'Tidak Ada')],
      ['Masa Tayang', t(l1.airingDuration)],
      ['Revisi Termasuk', t(l1.revisions)],
      ['Insight & Laporan', t(l1.reporting)],
      ['PIC Azera', t(l1.picAzera)],
      ['PIC Klien', t(l1.picClient)],
    ], ['KOMPONEN', 'KETERANGAN'])}

    <div class="nobreak">
      <div style="color:${D};margin:14px 0 8px;">HAK PENGGUNAAN KONTEN</div>
      ${kv([
        ['Repost organic di akun brand', right('repost', (x) => ` - Durasi: ${t(x.duration)} - Platform: ${t(x.platform)}`)],
        ['Paid media / ads', right('paidAds', (x) => ` - Durasi: ${t(x.duration)} - Wilayah: ${t(x.region)}`)],
        ['Whitelisting / code boost', right('whitelisting', (x) => ` - Durasi: ${t(x.duration)}`)],
        ['Editing/cutdown', right('editing', (x) => ` - Batasan: ${t(x.limit)}`)],
        ['Exclusivity', right('exclusivity', (x) => ` - Kategori: ${t(x.category)} - Durasi: ${t(x.duration)}`)],
      ], ['JENIS HAK', 'KETENTUAN'], D)}
    </div>

    <div class="pb"></div>
    <div class="c lamp">LAMPIRAN 2</div>
    <div class="c" style="color:${D};font-weight:bold;margin-bottom:12px;">NILAI KERJA SAMA DAN PEMBAYARAN</div>
    ${kv([
      ['Nilai Jasa', rp(l2.serviceFee)],
      ['Biaya Tambahan', biayaTambahan],
      ['Total Tagihan', rp(totalTagihan)],
      ['Termin 1', termin(obj(l2.termin1))],
      ['Termin 2', termin(obj(l2.termin2))],
      ['Termin Lain', t(l2.otherTermin, 'Tidak Ada')],
      ['Biaya Pembatalan', t(l2.cancellationFee)],
      ['Ketentuan standar yang dikecualikan', t(l2.exceptions, 'Tidak Ada')],
    ], ['KOMPONEN', 'NILAI / KETENTUAN'])}
    <p class="j" style="font-size:8pt;color:${D};margin-top:4px;line-height:1.5;"><b>Ketentuan Khusus Campaign:</b> Apabila terdapat penyimpangan dari ketentuan standar dalam Perjanjian, setiap penyimpangan harus menyebut nomor pasal yang digantikan serta ketentuan penggantinya. Jika bagian ini tidak diisi atau dinyatakan “Tidak Ada”, seluruh ketentuan standar dalam Perjanjian tetap berlaku.</p>

    <div style="color:${D};margin-top:16px;">REKENING PEMBAYARAN</div>
    <div style="color:${D};font-weight:bold;margin-top:6px;line-height:2;">
      Bank: <span class="hl">${COMPANY.bankLong}</span><br>
      Nomor Rekening: <span class="hl">${COMPANY.accountNo}</span><br>
      Nama Pemilik Rekening: <span class="hl">${COMPANY.name}</span>
    </div>
    <div style="color:${D};margin-top:14px;">ALAMAT PEMBERITAHUAN</div>
    <div style="color:${D};font-weight:bold;margin-top:6px;line-height:2;">
      PIHAK PERTAMA: <span class="hl">${COMPANY.email} | ${COMPANY.whatsapp}</span><br>
      PIHAK KEDUA: <span class="hl">${t(l2.clientNotice)}</span>
    </div>
    <p class="j" style="color:${M};margin-top:14px;">Lampiran 1 dan Lampiran 2 merupakan bagian yang tidak terpisahkan dari Perjanjian Kerja Sama Jasa KOL Management ini.</p>
    <p style="text-align:right;color:${M};font-weight:bold;font-size:9pt;margin-top:14px;">Paraf PIHAK PERTAMA: [____] &nbsp;&nbsp; Paraf PIHAK KEDUA: [____]</p>
  </body></html>`

  const headerTemplate = `
    <div style="width:100%;margin:0 18mm;padding-bottom:4px;border-bottom:1px solid #e5e0ea;display:flex;justify-content:space-between;align-items:flex-end;font-family:'Times New Roman',serif;font-size:8pt;">
      <img src="${logos().mark}" style="height:30px;">
      <span><b style="color:${P}">AZERAKOL.ID</b> <span style="color:${M}">| PT AZERA CREATOR NETWORK</span></span>
    </div>`
  const footerTemplate = `
    <div style="width:100%;margin:0 18mm;text-align:right;font-family:'Times New Roman',serif;font-size:7.5pt;color:${M};">
      SPK Azera - Klien &nbsp;|&nbsp; Halaman <span class="pageNumber"></span>
    </div>`
  return { html, pdf: { headerTemplate, footerTemplate, margin: { top: '28mm', right: '18mm', bottom: '18mm', left: '18mm' } } }
}

export const RENDERERS = { invoice: renderInvoice, quotation: renderQuotation, spk_brand: renderSpk } as const
export type DocKind = keyof typeof RENDERERS
