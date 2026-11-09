import DocumentModel, { IDocument } from '../documents/document.model'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { buildRecap, type InvoiceRecap } from './financeRecap.routes'
import { ensureInvoiceShortIds, parseShortId } from './invoiceShortId.service'
import { scheduleFinanceSheetSync } from './financeSheet.service'

/**
 * Perintah keuangan di grup WA Invoice Maker (bot partnership), angkanya = Rekap Keuangan platform (buildRecap).
 * /panduan · /talang <id> <nominal> · /talangan · /bayar <id> <nominal> · /catatan <id> <teks> · /lunas [periode] · /lunas <id..> [tanggal] · /batal-lunas <id..> · /belum-lunas · /omset|/profit|/rekap [periode] · /piutang
 */
const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`
const MONTHS = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember']
const MONTH_ALIAS: Record<string, number> = Object.fromEntries([
  ...MONTHS.map((m, i) => [m, i]),
  ...['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des'].map((m, i) => [m, i]),
  ['agt', 7], ['ags', 7], ['aug', 7], ['oct', 9], ['dec', 11], ['may', 4],
])
const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
const todayParts = () => { const [y, m, d] = ymd(new Date()).split('-').map(Number); return { y, m: m - 1, d } }
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
const pad = (n: number) => String(n).padStart(2, '0')
const monthRange = (y: number, m: number) => ({ from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay(y, m))}`, label: `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} ${y}` })

export interface Period { from: string; to: string; label: string }

/** "" / "bulan ini" / "bulan lalu" / "minggu ini" / "hari ini" / "tahun ini" / "2026" / "oktober [2026]" → rentang tanggal invoice */
export function parsePeriod(input: string): Period | null {
  const t = input.trim().toLowerCase()
  const { y, m, d } = todayParts()
  if (!t || t === 'bulan ini') return monthRange(y, m)
  if (t === 'bulan lalu') return m === 0 ? monthRange(y - 1, 11) : monthRange(y, m - 1)
  if (t === 'hari ini') { const v = `${y}-${pad(m + 1)}-${pad(d)}`; return { from: v, to: v, label: 'Hari ini' } }
  if (t === 'minggu ini') {
    const now = new Date(Date.UTC(y, m, d))
    const mon = new Date(now); mon.setUTCDate(d - ((now.getUTCDay() + 6) % 7))
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
    return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10), label: 'Minggu ini' }
  }
  if (t === 'tahun ini') return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Tahun ${y}` }
  if (/^\d{4}$/.test(t)) return { from: `${t}-01-01`, to: `${t}-12-31`, label: `Tahun ${t}` }
  const mm = /^([a-z]+)\s*(\d{4})?$/.exec(t)
  if (mm && MONTH_ALIAS[mm[1]] !== undefined) return monthRange(mm[2] ? Number(mm[2]) : y, MONTH_ALIAS[mm[1]])
  return null
}

/** Tanggal bayar: "3 nov", "3 nov 2026", "2026-11-03", "03/11/2026", "hari ini"/"" (= hari ini) */
export function parsePaidDate(input: string): string | null {
  const t = input.trim().toLowerCase()
  const { y, m, d } = todayParts()
  if (!t || t === 'hari ini') return `${y}-${pad(m + 1)}-${pad(d)}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const slash = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/.exec(t)
  if (slash) return `${slash[3] ?? y}-${pad(Number(slash[2]))}-${pad(Number(slash[1]))}`
  const word = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/.exec(t)
  if (word && MONTH_ALIAS[word[2]] !== undefined) return `${word[3] ?? y}-${pad(MONTH_ALIAS[word[2]] + 1)}-${pad(Number(word[1]))}`
  return null
}

const HELP = [
  '💰 *Perintah Keuangan*',
  '',
  '`/belum-lunas` daftar invoice belum lunas (+ ID)',
  '`/lunas [periode]` daftar invoice lunas',
  '`/lunas 12` tandai invoice #12 lunas hari ini',
  '`/lunas 12 15 3 nov` tandai beberapa, tanggal bayar 3 Nov',
  '`/batal-lunas 12` batalkan tanda lunas',
  '`/omset [periode]` · `/profit [periode]` · `/rekap [periode]`',
  '`/piutang` total tagihan belum dibayar',
  '',
  '`/talang 12 5jt` catat dana talangan Azera untuk invoice #12 (`/talang 12 0` hapus)',
  '`/talangan` daftar & total dana talangan yang invoice-nya belum lunas',
  '`/bayar 12 4,5jt` catat klien sudah bayar sebagian (kurang bayar dihitung otomatis)',
  '`/catatan 12 transfer kurang 500rb` catatan invoice (`/catatan 12 -` hapus)',
  '',
  'Periode: _bulan ini_ (default), _bulan lalu_, _minggu ini_, _tahun ini_, _oktober 2026_, _2026_',
].join('\n')

/** /panduan (/help): semua perintah bot grup Invoice Maker dalam satu pesan */
const GUIDE = [
  '📖 *Panduan Bot Invoice Maker*',
  '',
  '🧾 *Buat invoice*',
  '`/invoice` lihat format & contoh, lalu kirim `/invoice` + isian di baris berikutnya',
  '',
  HELP,
  '',
  'ID invoice (#12) ada di balasan `/invoice`, daftar `/belum-lunas`, menu Invoice & Rekap Keuangan di platform.',
].join('\n')

type InvoiceRow = { shortId?: number; number: string; campaign: string; total: number; paid: boolean; paidAt: string; dueDate: string; overdue: boolean; issueDate: string; paidAmount: number; shortfall: number; note: string }

async function invoiceRows(tenantId: string, period?: Period): Promise<InvoiceRow[]> {
  const recap = await buildRecap(tenantId, period?.from ?? '', period?.to ?? '')
  return recap.groups.filter((g) => !g.hidden).flatMap((g) => g.invoices.map((i) => ({ ...i, campaign: g.campaign })))
}

const line = (i: InvoiceRow, paidView: boolean) =>
  `• *#${i.shortId ?? '-'}* ${i.campaign} · ${rp(i.total)}${paidView ? ` · lunas ${i.paidAt || '-'}` : `${i.shortfall ? ` · sudah bayar ${rp(i.paidAmount)}, kurang ${rp(i.shortfall)}` : ''}${i.dueDate ? ` · jatuh tempo ${i.dueDate}${i.overdue ? ' ⚠️' : ''}` : ''}`}${i.note ? `\n   📝 ${i.note}` : ''}`
const MAX_LINES = 40
const list = (rows: InvoiceRow[], paidView: boolean) =>
  [...rows.slice(0, MAX_LINES).map((r) => line(r, paidView)), ...(rows.length > MAX_LINES ? [`… dan ${rows.length - MAX_LINES} lagi (lihat Rekap Keuangan di platform)`] : [])].join('\n')

/** Tandai lunas / batal lunas, aturan sama dengan Rekap Keuangan platform (status + tanggal bayar di data.recap) */
export async function setPaid(doc: IDocument, paid: boolean, paidAt?: string) {
  const recap: InvoiceRecap = { ...((doc.data.recap || {}) as InvoiceRecap) }
  recap.status = paid ? 'paid' : 'unpaid'
  if (paid) recap.paidAt = paidAt || recap.paidAt || ymd(new Date())
  else delete recap.paidAt
  doc.data = { ...doc.data, recap }
  doc.markModified('data')
  await doc.save()
}

async function markPaid(tenantId: string, args: string[], paid: boolean): Promise<string> {
  const ids: number[] = []
  let k = 0
  for (; k < args.length; k++) { const id = parseShortId(args[k].replace(/,$/, '')); if (id === null) break; ids.push(id) }
  if (!ids.length) return '❌ Tulis ID invoice-nya, mis. `/lunas 12`. Lihat ID lewat `/belum-lunas`.'
  const paidAt = paid ? parsePaidDate(args.slice(k).join(' ')) : undefined
  if (paid && !paidAt) return '❌ Tanggal bayar tidak dikenali. Contoh: `/lunas 12 3 nov` atau `/lunas 12` (hari ini).'
  await ensureInvoiceShortIds(tenantId)
  const docs = await DocumentModel.find({ tenantId, type: 'invoice', shortId: { $in: ids } })
  const byId = new Map(docs.map((d) => [d.shortId, d]))
  const out: string[] = []
  for (const id of ids) {
    const doc = byId.get(id)
    if (!doc) { out.push(`❌ #${id} tidak ditemukan`); continue }
    const was = (doc.data.recap as InvoiceRecap | undefined)?.status === 'paid'
    await setPaid(doc, paid, paidAt ?? undefined)
    const label = `#${id} ${String(doc.data.number ?? '')}`
    out.push(paid ? `✅ ${label} lunas ${paidAt}${was ? ' (diperbarui)' : ''}` : `↩️ ${label} jadi belum lunas${was ? '' : ' (memang belum lunas)'}`)
  }
  if (docs.length) scheduleFinanceSheetSync(tenantId)
  return out.join('\n')
}

async function summary(tenantId: string, period: Period, kind: 'omset' | 'profit' | 'rekap'): Promise<string> {
  const { totals: t } = await buildRecap(tenantId, period.from, period.to)
  const margin = t.margin != null ? ` (margin ${t.margin}%)` : ''
  if (kind === 'omset') return `📈 *Omset ${period.label}*\n${rp(t.income)} dari ${t.paidCount} invoice lunas`
  if (kind === 'profit') return `💹 *Profit ${period.label}*\n${rp(t.profit)}${margin}\nUang masuk ${rp(t.income)} − uang keluar ${rp(t.expense)}`
  return [
    `📊 *Rekap ${period.label}*`,
    `Uang masuk: ${rp(t.income)} (${t.paidCount}/${t.invoiceCount} invoice lunas)`,
    `Uang keluar: ${rp(t.expense)}`,
    `Profit: ${rp(t.profit)}${margin}`,
    `Piutang: ${rp(t.receivable)}${t.overdue ? ` (${rp(t.overdue)} lewat jatuh tempo)` : ''}`,
  ].join('\n')
}

/** "5000000", "5.000.000", "5jt", "4,5 juta", "500rb", "Rp 2.500.000" → rupiah; null = tidak terbaca */
export function parseAmount(input: string): number | null {
  const s = input.toLowerCase().replace(/rp\.?/g, '').replace(/\s+/g, '')
  const m = s.match(/^(\d+(?:[.,]\d+)*)(jt|juta|rb|ribu|k)?$/)
  if (!m) return null
  const mult = m[2] === 'jt' || m[2] === 'juta' ? 1e6 : m[2] ? 1e3 : 1
  // Dengan satuan: koma/titik = desimal ("4,5jt"); tanpa satuan: titik/koma = pemisah ribuan
  const n = mult > 1 ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/[.,]/g, ''))
  return Number.isFinite(n) ? Math.round(n * mult) : null
}

async function findInvoice(tenantId: string, raw: string | undefined) {
  const id = raw ? parseShortId(raw.replace(/,$/, '')) : null
  if (id === null) return { error: '❌ Tulis ID invoice-nya, mis. `#12`. Lihat ID lewat `/belum-lunas`.' }
  await ensureInvoiceShortIds(tenantId)
  const doc = await DocumentModel.findOne({ tenantId, type: 'invoice', shortId: id })
  return doc ? { doc, id } : { error: `❌ Invoice #${id} tidak ditemukan` }
}

async function saveRecap(tenantId: string, doc: IDocument, patch: (r: InvoiceRecap) => void) {
  const recap: InvoiceRecap = { ...((doc.data.recap || {}) as InvoiceRecap) }
  patch(recap)
  doc.data = { ...doc.data, recap }
  doc.markModified('data')
  await doc.save()
  scheduleFinanceSheetSync(tenantId)
}

/** Nama campaign invoice untuk balasan bot (dari rekap, sama dengan yang tampil di platform) */
async function campaignOf(tenantId: string, docId: string): Promise<string> {
  const { groups } = await buildRecap(tenantId, '', '')
  return groups.find((g) => g.invoices.some((i) => i._id === docId))?.campaign ?? '-'
}

async function setAdvanceOrPaid(tenantId: string, args: string[], field: 'advance' | 'paidAmount'): Promise<string> {
  const usage = field === 'advance' ? '`/talang 12 5jt`' : '`/bayar 12 4,5jt`'
  const found = await findInvoice(tenantId, args[0])
  if ('error' in found) return `${found.error}
Contoh: ${usage}`
  const amount = parseAmount(args.slice(1).join(' '))
  if (amount === null) return `❌ Nominal tidak terbaca. Contoh: ${usage}`
  const { doc, id } = found
  const total = Number(doc.data.total) || 0
  if (field === 'paidAmount' && total && amount > total) return `❌ Nominal ${rp(amount)} lebih besar dari total invoice ${rp(total)}. Kalau sudah dibayar penuh, pakai \`/lunas ${id}\`.`
  await saveRecap(tenantId, doc, (r) => { if (amount) r[field] = amount; else delete r[field] })
  const campaign = await campaignOf(tenantId, String(doc._id))
  if (field === 'advance') {
    return amount
      ? `✅ *Dana Talangan Dicatat*\n• Invoice: #${id} ${String(doc.data.number ?? '')}\n• Campaign: ${campaign}\n• Nominal talangan: ${rp(amount)}\n\nRekap: \`/talangan\``
      : `↩️ Dana talangan invoice #${id} (${campaign}) dihapus.`
  }
  if (!amount) return `↩️ Catatan sudah dibayar invoice #${id} (${campaign}) dihapus.`
  return `✅ *Pembayaran Sebagian Dicatat*\n• Invoice: #${id} ${String(doc.data.number ?? '')}\n• Campaign: ${campaign}\n• Total: ${rp(total)}\n• Sudah dibayar: ${rp(amount)}\n• Kurang bayar: ${rp(Math.max(total - amount, 0))}`
}

async function setNote(tenantId: string, args: string[]): Promise<string> {
  const found = await findInvoice(tenantId, args[0])
  if ('error' in found) return `${found.error}\nContoh: \`/catatan 12 transfer kurang 500rb\``
  const text = args.slice(1).join(' ').trim()
  if (!text) return '❌ Tulis catatannya, mis. `/catatan 12 transfer kurang 500rb`. Hapus catatan: `/catatan 12 -`'
  const clear = text === '-'
  await saveRecap(tenantId, found.doc, (r) => { if (clear) delete r.note; else r.note = text.slice(0, 1000) })
  return clear ? `↩️ Catatan invoice #${found.id} dihapus.` : `📝 Catatan invoice #${found.id} disimpan:\n_${text.slice(0, 1000)}_`
}

async function advanceSummary(tenantId: string): Promise<string> {
  const { groups } = await buildRecap(tenantId, '', '')
  const rows = groups.filter((g) => !g.hidden).flatMap((g) => g.invoices.filter((i) => i.advance > 0 && !i.paid).map((i) => ({ ...i, campaign: g.campaign })))
  if (!rows.length) return '🎉 Tidak ada dana talangan aktif (semua invoice bertalangan sudah lunas).'
  const total = rows.reduce((s, i) => s + i.advance, 0)
  const campaigns = new Set(rows.map((i) => i.campaign)).size
  return [
    '💸 *Rekap Dana Talangan Azera*',
    `*${rp(total)}*`,
    '_Total dana campaign yang ditalangi dan invoice-nya belum lunas_',
    '',
    ...rows.slice(0, MAX_LINES).map((i) => `• *#${i.shortId ?? '-'}* ${i.campaign} · ${rp(i.advance)}`),
    ...(rows.length > MAX_LINES ? [`… dan ${rows.length - MAX_LINES} lagi (lihat Rekap Keuangan di platform)`] : []),
    '',
    `Total campaign: *${campaigns} campaign*`,
    'Talangan lepas otomatis saat invoice di-`/lunas`.',
  ].join('\n')
}

/** null = bukan perintah keuangan (handler /invoice yang lanjut memeriksa) */
export async function handleFinanceCommand(text: string): Promise<string | null> {
  const [head, ...rest] = text.trim().split(/\s+/)
  const cmd = head.toLowerCase()
  const known = ['/talang', '/talangan', '/bayar', '/catatan', '/lunas', '/belum-lunas', '/belumlunas', '/batal-lunas', '/omset', '/profit', '/piutang', '/rekap', '/keuangan', '/panduan', '/help']
  if (!known.includes(cmd)) return null
  const tenantId = String((await getDefaultTenant())._id)
  const arg = rest.join(' ')

  if (cmd === '/panduan' || cmd === '/help') return GUIDE
  if (cmd === '/keuangan') return HELP
  if (cmd === '/talang') return setAdvanceOrPaid(tenantId, rest, 'advance')
  if (cmd === '/talangan') return advanceSummary(tenantId)
  if (cmd === '/bayar') return setAdvanceOrPaid(tenantId, rest, 'paidAmount')
  if (cmd === '/catatan') return setNote(tenantId, rest)
  if (cmd === '/batal-lunas') return markPaid(tenantId, rest, false)
  if (cmd === '/lunas' && rest[0] && parseShortId(rest[0].replace(/,$/, '')) !== null) return markPaid(tenantId, rest, true)
  if (cmd === '/belum-lunas' || cmd === '/belumlunas') {
    const rows = (await invoiceRows(tenantId)).filter((r) => !r.paid).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate || '9').localeCompare(b.dueDate || '9'))
    if (!rows.length) return '🎉 Semua invoice sudah lunas.'
    const total = rows.reduce((s, r) => s + r.total - r.paidAmount, 0) // sisa tagihan (bayar sebagian dikurangi)
    return `🧾 *Belum Lunas* (${rows.length} invoice · ${rp(total)})\n${list(rows, false)}\n\nTandai lunas: \`/lunas <ID>\``
  }
  if (cmd === '/piutang') {
    const rows = (await invoiceRows(tenantId)).filter((r) => !r.paid)
    const total = rows.reduce((s, r) => s + r.total - r.paidAmount, 0) // sisa tagihan (bayar sebagian dikurangi)
    const overdue = rows.filter((r) => r.overdue)
    return `💳 *Piutang*\n${rp(total)} dari ${rows.length} invoice belum lunas${overdue.length ? `\n⚠️ ${rp(overdue.reduce((s, r) => s + r.total - r.paidAmount, 0))} (${overdue.length} invoice) lewat jatuh tempo` : ''}\n\nDetail: \`/belum-lunas\``
  }
  const period = parsePeriod(arg)
  if (!period) return `❌ Periode "${arg}" tidak dikenali.\n\n${HELP}`
  if (cmd === '/lunas') {
    const rows = (await invoiceRows(tenantId, period)).filter((r) => r.paid)
    return rows.length ? `✅ *Lunas · ${period.label}* (${rows.length} invoice · ${rp(rows.reduce((s, r) => s + r.total, 0))})\n${list(rows, true)}` : `Belum ada invoice lunas di ${period.label}.`
  }
  return summary(tenantId, period, cmd.slice(1) as 'omset' | 'profit' | 'rekap')
}
