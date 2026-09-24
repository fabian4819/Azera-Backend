import fs from 'fs'
import path from 'path'
import { PdfOptions } from '../../lib/pdf'
import { SPK_INTRO, SPK_PASAL, QUOTATION_TERMS } from './templateText'

/**
 * Template Quotation / Invoice / SPK — dibuat ulang dari Google Docs klien (24 Sep 2026).
 * Satu template, dua mode:
 * - 'pdf'  → HTML untuk Puppeteer (lib/pdf.ts)
 * - 'edit' → HTML yang sama, tiap bagian [ ] jadi kotak isian langsung di dokumen
 *            (dipakai editor admin di iframe; tanpa JS — lihat EDIT_CSP)
 * Semua isian user WAJIB lewat esc() / helper F.
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
export type RenderMode = 'pdf' | 'edit'

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
const arr = (v: unknown): Data[] => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? (x as Data) : {})) : [])
const getPath = (o: unknown, p: string): unknown =>
  p.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Data)[k] : undefined), o)

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

/**
 * Helper field per mode. `p` = path di data (mis. "client.company", "items.0.qty").
 * Mode edit: data-k = path (dibaca editor), data-rerender = minta render ulang saat berubah
 * (untuk teks turunan: hari/tanggal SPK, YA/TIDAK hak konten, mekanisme listing).
 */
function fields(d: Data, mode: RenderMode) {
  const edit = mode === 'edit'
  const v = (p: string) => getPath(d, p)
  const inputVal = (p: string) => esc(v(p) ?? '')
  return {
    edit,
    v,
    text(p: string, ph: string, empty = '-') {
      if (!edit) return t(v(p), empty)
      return `<span class="fx" contenteditable="plaintext-only" data-k="${p}" data-ph="${esc(ph)}">${esc(v(p) ?? '')}</span>`
    },
    money(p: string, emptyPdf?: string) {
      if (!edit) return emptyPdf !== undefined && !n(v(p)) ? emptyPdf : rp(v(p))
      return `Rp<input class="fx num" type="number" min="0" data-k="${p}" data-kind="number" value="${inputVal(p)}" placeholder="0">`
    },
    int(p: string, ph = '1', emptyPdf = '1') {
      if (!edit) return String(v(p) ?? '').trim() ? esc(v(p)) : emptyPdf
      return `<input class="fx int" type="number" min="0" data-k="${p}" data-kind="number" value="${inputVal(p)}" placeholder="${esc(ph)}">`
    },
    date(p: string, empty = '-') {
      if (!edit) return String(v(p) ?? '').trim() ? dateID(v(p)) : empty
      return `<input class="fx" type="date" data-k="${p}" data-rerender value="${inputVal(p)}">`
    },
    select(p: string, options: [string, string][]) {
      if (!edit) return esc(options.find(([val]) => val === v(p))?.[1] ?? options[0][1])
      return `<select class="fx" data-k="${p}" data-rerender>${options.map(([val, label]) => `<option value="${esc(val)}"${val === v(p) ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`
    },
    check(p: string) {
      return edit ? `<input type="checkbox" data-k="${p}" data-kind="bool" data-rerender${v(p) === true ? ' checked' : ''}>` : ''
    },
    /** Salinan teks field lain (mis. nama klien di beberapa tempat) — ikut berubah saat mengetik */
    mirror(p: string, empty: string) {
      return edit ? `<span data-mirror="${p}" data-empty="${esc(empty)}">${t(v(p), esc(empty))}</span>` : t(v(p), esc(empty))
    },
    /** Angka hasil hitung (amount/subtotal/total) — dihitung ulang editor saat angka diubah */
    calc(key: string, html: string) {
      return edit ? `<span data-calc="${key}">${html}</span>` : html
    },
    /** Tombol tambah/hapus baris — cuma di mode edit */
    action(name: string, label: string, i?: number) {
      return edit ? `<button type="button" class="act" data-action="${name}"${i !== undefined ? ` data-i="${i}"` : ''}>${label}</button>` : ''
    },
  }
}

/** Baris item: PDF membuang baris tanpa nama; editor menampilkan semua (termasuk baris kosong baru) */
function itemRows(d: Data, mode: RenderMode) {
  return arr(d.items)
    .map((it, i) => {
      const qtyN = it.qty === '' || it.qty === undefined || it.qty === null ? 1 : n(it.qty)
      return { i, it, qtyN, amount: qtyN * n(it.unitFee) }
    })
    .filter((r) => mode === 'edit' || String(r.it.name ?? '').trim())
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', 'FreeSerif', 'Liberation Serif', serif; font-size: 10pt; line-height: 1.35; -webkit-print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; }
  .pb { break-before: page; }
  .nobreak { break-inside: avoid; }
`

/** Tampilan "kertas" + kotak isian untuk mode edit. Tanpa JS: CSP memblokir script di iframe editor. */
const EDIT_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`
const editCss = (pad: string) => `
  html { background: #dcdce3; }
  body { width: 210mm; min-height: 297mm; margin: 24px auto; padding: ${pad}; background: #fff; box-shadow: 0 2px 18px rgba(0,0,0,.18); }
  .pb { height: 26px; margin: 14mm -18mm; background: #dcdce3; box-shadow: inset 0 6px 8px -6px rgba(0,0,0,.25), inset 0 -6px 8px -6px rgba(0,0,0,.25); }
  .fx { background: #fff4bf; border-bottom: 1.5px dashed #c9a400; outline: none; font: inherit; color: inherit; padding: 0 2px; border-radius: 2px; }
  .fx:focus { background: #ffe680; }
  span.fx:empty::before { content: attr(data-ph); color: #9a7d10; font-style: italic; font-weight: normal; }
  input.fx, select.fx { border: none; border-bottom: 1.5px dashed #c9a400; height: 1.6em; }
  input.fx.num { width: 12ch; text-align: right; }
  input.fx.int { width: 6ch; text-align: center; }
  input[type=date].fx { width: 17ch; }
  .act { font: 600 8pt system-ui, sans-serif; cursor: pointer; background: #ede9fe; border: 1px dashed #7c3aed; color: #5b21b6; padding: 2px 8px; border-radius: 4px; margin: 4px 2px; }
  .act.del { padding: 0 6px; margin-left: 4px; }
`
function wrapHtml(mode: RenderMode, css: string, editPad: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8">${mode === 'edit' ? EDIT_CSP : ''}<style>${BASE_CSS}${css}${mode === 'edit' ? editCss(editPad) : ''}</style></head><body>${body}</body></html>`
}

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

export interface Rendered { html: string; pdf: PdfOptions }

/* ------------------------------------------------------------------ INVOICE */

export function renderInvoice(d: Data, mode: RenderMode = 'pdf'): Rendered {
  const P = '#4b2fc4', L = '#f1eeff', LL = '#f8f7fc', M = '#666375', INK = '#111111'
  const F = fields(d, mode)
  const rows = itemRows(d, mode)
  const subtotal = rows.reduce((s, r) => s + r.amount, 0)
  const discount = Math.min(n(d.discount), subtotal)
  const total = subtotal - discount

  const css = `
    body { color: ${INK}; }
    h3 { color: ${P}; font-size: 10pt; margin: 14px 0 6px; }
    .meta td { background: ${L}; padding: 8px 9px; width: 25%; vertical-align: top; border-right: 6px solid #fff; }
    .meta small { display: block; font-size: 7.5pt; font-weight: bold; color: ${M}; }
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
    .pay td.k { background: ${LL}; color: ${M}; font-size: 7.5pt; font-weight: bold; width: 45%; }`

  const body = `
    ${letterhead(P, M, 'INVOICE', `background:${P};color:#fff;font-size:17pt;font-weight:bold;width:210px;height:74px;display:flex;align-items:center;justify-content:center;`)}

    <table class="meta" style="margin-top:14px;"><tr>
      <td><small>INVOICE NO.</small><b>${F.text('number', 'otomatis saat disimpan')}</b></td>
      <td><small>ISSUED DATE</small><b>${F.date('issueDate')}</b></td>
      <td><small>DUE DATE</small><b>${F.date('dueDate')}</b></td>
      <td><small>REFERENCE</small><b>${F.text('reference', 'Quotation / SPK No.')}</b></td>
    </tr></table>

    <h3>COMPANY INFORMATION</h3>
    <table class="box"><tr>
      <td style="background:${L};border-right:1px solid #d9d3f7;">
        <div class="h">FROM</div><div class="who">${COMPANY.name}</div>
        <b>NPWP:</b> ${COMPANY.npwp}<br><b>Email:</b> ${COMPANY.email}<br><b>WhatsApp:</b> ${COMPANY.whatsapp}
      </td>
      <td>
        <div class="h">BILL TO</div><div class="who">${F.text('billTo.name', 'Legal company / brand name')}</div>
        <b>PIC:</b> ${F.text('billTo.pic', 'Nama PIC', '')}<br><b>NPWP:</b> ${F.text('billTo.npwp', 'NPWP', '')}<br><b>Contact:</b> ${F.text('billTo.contact', 'Telepon / email', '')}
      </td>
    </tr></table>

    <h3>INVOICE DETAILS</h3>
    <table class="it">
      <tr><th style="width:9%">No.</th><th>Service / Description</th><th style="width:11%">Qty</th><th style="width:17%">Unit Fee</th><th style="width:17%">Amount</th></tr>
      ${rows.map((r, k) => `<tr>
        <td>${k + 1}${F.action('del-item', '×', r.i)}</td>
        <td class="d"><b>${F.text(`items.${r.i}.name`, 'Campaign / service name')}</b>${F.edit || String(r.it.description ?? '').trim() ? `<small>${F.text(`items.${r.i}.description`, 'Deliverables / periode / creator tier (opsional)', '')}</small>` : ''}</td>
        <td>${F.int(`items.${r.i}.qty`)}</td><td>${F.money(`items.${r.i}.unitFee`)}</td><td>${F.calc(`amount.${r.i}`, rp(r.amount))}</td>
      </tr>`).join('')}
    </table>
    ${F.action('add-item', '+ Tambah baris')}

    <table class="tot" style="margin-top:12px;">
      <tr><td>Subtotal Net</td><td style="text-align:right;font-weight:bold;">${F.calc('subtotal', rp(subtotal))}</td></tr>
      ${discount > 0 ? `<tr><td>Discount</td><td style="text-align:right;font-weight:bold;">- ${rp(discount)}</td></tr>` : ''}
      <tr class="grand"><td style="width:45%">TOTAL INVOICE</td><td style="text-align:right;font-size:14pt;">${F.calc('total', rp(total))}</td></tr>
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
    </div>`

  return {
    html: wrapHtml(mode, css, '16mm 18mm', body),
    pdf: { footerTemplate: simpleFooter(M), headerTemplate: '<span></span>', margin: { top: '16mm', right: '18mm', bottom: '18mm', left: '18mm' } },
  }
}

/* ---------------------------------------------------------------- QUOTATION */

export function renderQuotation(d: Data, mode: RenderMode = 'pdf'): Rendered {
  const P = '#4930b8', L = '#f3f0ff', LL = '#faf9fd', M = '#666674', INK = '#1c1c24'
  const F = fields(d, mode)
  const rows = itemRows(d, mode)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const bullet = (label: string, p: string, ph: string) => `<div>➢&nbsp;&nbsp; ${label}: ${F.text(p, ph)}</div>`
  const optDate = (p: string) => F.date(p, '&nbsp;')

  const css = `
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
    .sign .s { color: ${M}; }`

  const body = `
    ${letterhead(P, M, 'QUOTATION', `background:${P};color:#fff;font-size:15pt;font-weight:bold;padding:2px 6px;align-self:flex-start;`)}

    <div style="font-size:24pt;font-weight:bold;margin-top:20px;">KOL Campaign Quotation</div>
    <div style="color:${M};font-size:9pt;margin-bottom:8px;">Penawaran resmi untuk pelaksanaan campaign berdasarkan ruang lingkup dan ketentuan berikut.</div>
    <table class="meta">
      <tr><td class="k">QUOTATION NO.</td><td><b>${F.text('number', 'otomatis saat disimpan')}</b></td><td class="k">ISSUED DATE</td><td><b>${F.date('issueDate')}</b></td></tr>
      <tr><td class="k">VALID UNTIL</td><td><b>${F.date('validUntil')}</b></td><td class="k">PREPARED BY</td><td>Business Development | <b>azerakol.id</b></td></tr>
    </table>

    <h3>CLIENT INFORMATION</h3>
    <table class="info">
      <tr><td class="k">COMPANY / BRAND</td><td>${F.text('client.company', 'Legal company name / brand name')}</td></tr>
      <tr><td class="k">ADDRESS</td><td>${F.text('client.address', 'Complete company address')}</td></tr>
      <tr><td class="k">PIC</td><td>${F.text('client.picName', 'Full name')} | ${F.text('client.picPosition', 'Position')} | ${F.text('client.picContact', 'Phone / Email')}</td></tr>
      <tr><td class="k">TAX INFORMATION</td><td>${F.text('client.tax', 'NPWP / Non-NPWP')}</td></tr>
    </table>

    <h3>CAMPAIGN INFORMATION</h3>
    <table class="info">
      <tr><td class="k">CAMPAIGN</td><td>${F.text('campaign.name', 'Campaign / Product Name')}</td></tr>
      <tr><td class="k">PERIOD</td><td>${bullet('Campaign period', 'campaign.period', '1–31 Oktober 2026')}${bullet('Expected posting date', 'campaign.postingDate', '10–20 Oktober 2026')}</td></tr>
      <tr><td class="k">CREATOR CRITERIA</td><td>${bullet('Tier Followers', 'campaign.tier', 'Nano (1K–10K)')}${bullet('Platform', 'campaign.platform', 'TikTok, Instagram')}${bullet('Niche', 'campaign.niche', 'Niche')}${bullet('Demographic', 'campaign.demographic', 'Wanita 20–35, Jawa Tengah')}</td></tr>
      <tr><td class="k">APPROVAL</td><td>Pemilihan final KOL akan dikonfirmasi melalui approval sheet yang telah disepakati.</td></tr>
    </table>

    <h3>SCOPE OF WORK AND INVESTMENT</h3>
    <table class="it">
      <tr><th style="width:11%">No.</th><th>Service / Deliverables</th><th style="width:11%">Qty</th><th style="width:17%">Net Unit Fee</th><th style="width:15%">Net Amount</th></tr>
      ${rows.map((r, k) => `<tr>
        <td>${k + 1}${F.action('del-item', '×', r.i)}</td>
        <td class="d"><b>${F.text(`items.${r.i}.name`, 'KOL tier and activation service')}</b>${F.edit || String(r.it.sow ?? '').trim() ? `<br>SOW: ${F.text(`items.${r.i}.sow`, 'e.g. 1x TikTok Video + IG Reels Mirror', '')}` : ''}</td>
        <td>${F.int(`items.${r.i}.qty`)}</td><td>${F.money(`items.${r.i}.unitFee`)}</td><td>${F.calc(`amount.${r.i}`, rp(r.amount))}</td>
      </tr>`).join('')}
    </table>
    ${F.action('add-item', '+ Tambah baris')}
    <table style="width:60%;margin-top:4px;">
      <tr><td style="color:${M};font-size:8pt;padding:4px 8px;">Subtotal Net Campaign Fee</td><td style="text-align:right;font-weight:bold;padding:4px 8px;">${F.calc('subtotal', rp(total))}</td></tr>
      <tr style="background:${P};color:#fff;font-weight:bold;"><td style="padding:8px;font-size:9pt;">TOTAL NET CAMPAIGN FEE</td><td style="text-align:right;padding:8px;font-size:14pt;">${F.calc('total', rp(total))}</td></tr>
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
        <div><span class="h">PROPOSED BY</span><div><b>${COMPANY.director}</b><div class="s">${COMPANY.name}</div><div class="s">${optDate('approval.proposedDate')}</div></div></div>
        <div><span class="h">APPROVED BY</span><div><b>${F.text('approval.approverName', 'Nama penyetuju (opsional)', '&nbsp;')}</b><div class="s">${F.text('approval.approverCompany', 'Perusahaan', '&nbsp;')}</div><div class="s">${optDate('approval.approvedDate')}</div></div></div>
      </div>
    </div>`

  return {
    html: wrapHtml(mode, css, '16mm 16mm', body),
    pdf: { footerTemplate: simpleFooter(M), headerTemplate: '<span></span>', margin: { top: '16mm', right: '16mm', bottom: '18mm', left: '16mm' } },
  }
}

/* ---------------------------------------------------------------------- SPK */

export function renderSpk(d: Data, mode: RenderMode = 'pdf'): Rendered {
  const P = '#6f2c91', D = '#43205c', L = '#f3ebf7', INK = '#25212a', M = '#6c6670'
  const F = fields(d, mode)
  const sd = parseDate(d.signDate)
  const client = F.mirror('client.company', '[NAMA BADAN USAHA KLIEN]')

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
  /** Baris hak konten: centang = YA + isian detail; tidak dicentang = "TIDAK" */
  const right = (key: string, extra: [string, string, string][]) => {
    const on = F.v(`rights.${key}.enabled`) === true
    const detail = on ? extra.map(([label, sub, ph]) => ` - ${label}: ${F.text(`rights.${key}.${sub}`, ph)}`).join('') : ''
    return `${F.check(`rights.${key}.enabled`)} ${on ? 'YA' : 'TIDAK'}${detail}`
  }
  const tanpa = F.v('lampiran1.mechanism') === 'tanpa'
  const termin = (p: string) => `${F.int(`${p}.percent`, '50', '-')}% / ${F.money(`${p}.amount`)} - jatuh tempo ${F.text(`${p}.due`, 'tanggal / keterangan')}`
  const spkTotal = n(F.v('lampiran2.serviceFee')) + n(F.v('lampiran2.additionalFee'))

  const css = `
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
    .hl { background: #fff2cc; }`

  const body = `
    <div class="c" style="color:${D};font-size:18pt;font-weight:bold;">PERJANJIAN KERJA SAMA</div>
    <div class="c" style="color:${P};font-size:13pt;font-weight:bold;">JASA KOL MANAGEMENT</div>
    <div class="c" style="color:${M};font-weight:bold;font-size:10pt;">Nomor: ${F.text('number', 'otomatis saat disimpan')}</div>

    <p class="j" style="margin-top:16px;">Pada hari ini, ${sd ? DAYS[sd.getUTCDay()] : '-'}, tanggal ${sd ? sd.getUTCDate() : '-'} bulan ${sd ? MONTHS[sd.getUTCMonth()] : '-'} tahun ${sd ? sd.getUTCFullYear() : '-'}, Para Pihak yang bertanda tangan di bawah ini menerangkan dan menyepakati hal-hal sebagai berikut:</p>

    ${party('PIHAK PERTAMA', P, [['Nama Perusahaan', 'PT AZERA CREATOR NETWORK'], ['Diwakili oleh', COMPANY.director], ['Jabatan', 'Direktur'], ['Alamat', 'Gedung Sovoism, Jl. Dr. Cipto No. 20, Bugangan, Semarang Timur, Kota Semarang'], ['NPWP', COMPANY.npwp]])}
    <p class="j" style="margin-top:4px;">Dalam hal ini bertindak secara sah untuk dan atas nama ${COMPANY.name}, selanjutnya disebut PIHAK PERTAMA.</p>
    ${party('PIHAK KEDUA', D, [
      ['Nama Perusahaan', F.text('client.company', 'Nama badan usaha klien')],
      ['Diwakili oleh', F.text('client.signer', 'Nama penandatangan')],
      ['Jabatan', F.text('client.position', 'Jabatan')],
      ['Alamat', F.text('client.address', 'Alamat lengkap')],
      ['NPWP', F.text('client.npwp', 'NPWP')],
    ])}
    <p class="j" style="margin-top:4px;">Dalam hal ini bertindak secara sah untuk dan atas nama ${client}, selanjutnya disebut PIHAK KEDUA.</p>
    ${SPK_INTRO.map((x) => `<p class="j">${esc(x)}</p>`).join('')}

    ${SPK_PASAL.map((ps, pi) => `
      <div class="pasal">
        <h4>PASAL ${pi + 1} &nbsp;|&nbsp; ${esc(ps.title)}</h4>
        <ol>${ps.items.map((it, ii) => `<li><span class="num">(${ii + 1})</span>${esc(it.text)}${it.subs.map((s) => `<p>${esc(s).replace(/^([ab]\.) (.+?),/, '$1 <b>$2</b>,')}</p>`).join('')}</li>`).join('')}</ol>
      </div>`).join('')}

    <div class="nobreak" style="margin-top:18px;">
      <div class="c" style="color:${D};font-weight:bold;">${F.text('city', 'Kota', '[KOTA]')}, ${F.edit ? F.date('signDate') : sd ? dateID(d.signDate) : '[TANGGAL PENANDATANGANAN]'}</div>
      <table style="margin-top:14px;text-align:center;color:${D};font-weight:bold;font-size:10pt;">
        <tr><td style="width:50%">PIHAK PERTAMA</td><td>PIHAK KEDUA</td></tr>
        <tr><td>PT AZERA CREATOR NETWORK</td><td>${client}</td></tr>
        <tr><td style="height:110px;"></td><td></td></tr>
        <tr><td style="color:${INK}">${COMPANY.director}<br>Direktur</td><td style="color:${INK}">${F.mirror('client.signer', '[NAMA PENANDATANGAN]')}<br>${F.mirror('client.position', '[JABATAN]')}</td></tr>
      </table>
    </div>

    <div class="pb"></div>
    <div class="c lamp">LAMPIRAN 1</div>
    <div class="c" style="color:${D};font-weight:bold;margin-bottom:12px;">DETAIL CAMPAIGN DAN RUANG LINGKUP</div>
    ${kv([
      ['Nama Campaign', F.text('lampiran1.campaignName', 'Nama campaign')],
      ['Brand/Produk', F.text('lampiran1.brandProduct', 'Nama brand / produk')],
      ['Periode', `${F.date('lampiran1.periodStart')} s.d. ${F.date('lampiran1.periodEnd')}`],
      ['Platform', F.text('lampiran1.platform', 'TikTok / Instagram / X / Threads / Lainnya')],
      ['Target KOL', F.text('lampiran1.targetKol', 'Jumlah, tier, domisili, niche, kriteria')],
      ['Referensi Sample List', F.text('lampiran1.sampleList', 'Tautan sample list')],
      ['Status Sample', `Telah disetujui melalui ${F.text('lampiran1.sampleApprovedVia', 'WhatsApp / Email / Media lain')} pada ${F.date('lampiran1.sampleApprovedDate')}`],
      ['Mekanisme Pemilihan Full Listing', F.select('lampiran1.mechanism', [['dengan', 'DENGAN APPROVAL KLIEN'], ['tanpa', 'TANPA APPROVAL INDIVIDUAL KLIEN']])],
      ['Approval Full Listing', tanpa ? 'Tidak berlaku karena menggunakan mekanisme tanpa approval individual' : 'Maksimal 3 (tiga) Hari Kerja'],
      ['Approval Draft Materi Konten', 'Maksimal 3 (tiga) Hari Kerja sejak materi diterima'],
      ['Deliverables', F.text('lampiran1.deliverables', 'Jumlah dan jenis konten per KOL')],
      ['Aktivitas Tambahan', F.text('lampiran1.extraActivities', 'Visit / Live / Event / Product delivery (kosong = Tidak Ada)', 'Tidak Ada')],
      ['Masa Tayang', F.text('lampiran1.airingDuration', 'Durasi konten wajib tetap tayang')],
      ['Revisi Termasuk', F.text('lampiran1.revisions', 'Jumlah revisi / batasan')],
      ['Insight & Laporan', F.text('lampiran1.reporting', 'Metrik, format, dan deadline')],
      ['PIC Azera', F.text('lampiran1.picAzera', 'Nama | Email | WhatsApp')],
      ['PIC Klien', F.text('lampiran1.picClient', 'Nama | Email | WhatsApp')],
    ], ['KOMPONEN', 'KETERANGAN'])}

    <div class="nobreak">
      <div style="color:${D};margin:14px 0 8px;">HAK PENGGUNAAN KONTEN</div>
      ${kv([
        ['Repost organic di akun brand', right('repost', [['Durasi', 'duration', 'durasi'], ['Platform', 'platform', 'platform']])],
        ['Paid media / ads', right('paidAds', [['Durasi', 'duration', 'durasi'], ['Wilayah', 'region', 'wilayah']])],
        ['Whitelisting / code boost', right('whitelisting', [['Durasi', 'duration', 'durasi']])],
        ['Editing/cutdown', right('editing', [['Batasan', 'limit', 'batasan']])],
        ['Exclusivity', right('exclusivity', [['Kategori', 'category', 'kategori'], ['Durasi', 'duration', 'durasi']])],
      ], ['JENIS HAK', 'KETENTUAN'], D)}
    </div>

    <div class="pb"></div>
    <div class="c lamp">LAMPIRAN 2</div>
    <div class="c" style="color:${D};font-weight:bold;margin-bottom:12px;">NILAI KERJA SAMA DAN PEMBAYARAN</div>
    ${kv([
      ['Nilai Jasa', F.money('lampiran2.serviceFee')],
      ['Biaya Tambahan', F.money('lampiran2.additionalFee', 'Tidak Ada')],
      ['Total Tagihan', F.calc('spkTotal', rp(spkTotal))],
      ['Termin 1', termin('lampiran2.termin1')],
      ['Termin 2', termin('lampiran2.termin2')],
      ['Termin Lain', F.text('lampiran2.otherTermin', 'Jika ada (kosong = Tidak Ada)', 'Tidak Ada')],
      ['Biaya Pembatalan', F.text('lampiran2.cancellationFee', 'Rumus/persentase + biaya yang sudah timbul')],
      ['Ketentuan standar yang dikecualikan', F.text('lampiran2.exceptions', 'Sebutkan pasal & ketentuan penggantinya (kosong = Tidak Ada)', 'Tidak Ada')],
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
      PIHAK KEDUA: <span class="hl">${F.text('lampiran2.clientNotice', 'Email | Nomor WhatsApp | Alamat')}</span>
    </div>
    <p class="j" style="color:${M};margin-top:14px;">Lampiran 1 dan Lampiran 2 merupakan bagian yang tidak terpisahkan dari Perjanjian Kerja Sama Jasa KOL Management ini.</p>
    <p style="text-align:right;color:${M};font-weight:bold;font-size:9pt;margin-top:14px;">Paraf PIHAK PERTAMA: [____] &nbsp;&nbsp; Paraf PIHAK KEDUA: [____]</p>`

  const headerTemplate = `
    <div style="width:100%;margin:0 18mm;padding-bottom:4px;border-bottom:1px solid #e5e0ea;display:flex;justify-content:space-between;align-items:flex-end;font-family:'Times New Roman',serif;font-size:8pt;">
      <img src="${logos().mark}" style="height:30px;">
      <span><b style="color:${P}">AZERAKOL.ID</b> <span style="color:${M}">| PT AZERA CREATOR NETWORK</span></span>
    </div>`
  const footerTemplate = `
    <div style="width:100%;margin:0 18mm;text-align:right;font-family:'Times New Roman',serif;font-size:7.5pt;color:${M};">
      SPK Azera - Klien &nbsp;|&nbsp; Halaman <span class="pageNumber"></span>
    </div>`
  return {
    html: wrapHtml(mode, css, '20mm 18mm', body),
    pdf: { headerTemplate, footerTemplate, margin: { top: '28mm', right: '18mm', bottom: '18mm', left: '18mm' } },
  }
}

export const RENDERERS = { invoice: renderInvoice, quotation: renderQuotation, spk_brand: renderSpk } as const
export type DocKind = keyof typeof RENDERERS
