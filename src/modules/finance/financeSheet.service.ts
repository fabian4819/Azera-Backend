import crypto from 'crypto'
import Tenant from '../tenants/tenant.model'
import { env } from '../../config/env'
import DocumentModel from '../documents/document.model'
import { createCampaignWorkbook, writeWorkbookTabs, getWorkbookTabUrl, sharedDriveRootId, deleteWorkbookTab, type WorkbookTab } from '../../lib/googleSheets'
import { installSheetHook } from '../../lib/sheetHook'
import { buildRecap, type InvoiceRecap } from './financeRecap.routes'
import { updateCampaignFinance, type FeeField } from './financeRecord.routes'
import { setPaid } from './financeBot.service'
import { lastWritten, ID_HEADER } from '../campaigns/campaignWorkbook.service'
import { isPintarnyaClient } from './clientName'

/**
 * Rekap Keuangan → spreadsheet "Rekap Keuangan | AZERA" di Shared Drive (menggantikan Export Excel).
 * Dua spreadsheet terpisah (semua klien + khusus Pintarnya), semua periode dalam satu Tabel (filter per bulan di Sheets), 1 baris per campaign/grup invoice supaya
 * jumlah per kolom tidak dobel; SOW digabung dalam satu sel. Realtime dua arah: platform → sheet ditulis ulang
 * tiap perubahan; sheet → platform lewat Apps Script (applyFinanceSheetRow) untuk kolom Status & biaya saja,
 * kolom lain dikunci. Kolom A tersembunyi = ID invoice (Document) di baris itu.
 */
const TAB = 'Rekap Keuangan'
// Tab lama "Pintarnya" di spreadsheet utama, dipindah jadi spreadsheet sendiri → dihapus
const OLD_PINTARNYA_TAB = 'Pintarnya'
export type FinanceScope = 'all' | 'pintarnya'
const SCOPES: Record<FinanceScope, { idKey: 'financeRecapSpreadsheetId' | 'financeRecapPintarnyaSpreadsheetId'; hookKey: 'financeRecapHooked' | 'financeRecapPintarnyaHooked'; title: string }> = {
  all: { idKey: 'financeRecapSpreadsheetId', hookKey: 'financeRecapHooked', title: 'Rekap Keuangan | AZERA' },
  pintarnya: { idKey: 'financeRecapPintarnyaSpreadsheetId', hookKey: 'financeRecapPintarnyaHooked', title: 'Rekap Keuangan Pintarnya | AZERA' },
}
const isPintarnya = isPintarnyaClient // termasuk "PDS Digital Agency"
const STATUS_OPTIONS = ['Lunas', 'Belum Lunas']
/** Kolom biaya yang bisa diedit dari sheet (baris yang terhubung ke campaign) → field FinanceRecord */
const FEE_HEADERS: Record<string, FeeField> = {
  'Fee Creator': 'feeCreator', 'Fee PIC': 'feePic', 'Fee MG': 'feeMg', 'Fee Handle by': 'feeHandle',
  'Gaji Admin': 'adminInternal', Reimburse: 'reimburse', Ads: 'ads', Opex: 'opex',
}
const monthLabel = (ym: string) => (ym ? new Date(`${ym}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '')

async function ensureSpreadsheet(tenantId: string, scope: FinanceScope): Promise<string | null> {
  const { idKey, title } = SCOPES[scope]
  const tenant = await Tenant.findById(tenantId).select(`settings.${idKey}`)
  const existing = tenant?.settings?.[idKey]
  if (existing) return existing
  const created = await createCampaignWorkbook(title, [TAB], sharedDriveRootId())
  if (created) await Tenant.updateOne({ _id: tenantId }, { $set: { [`settings.${idKey}`]: created } })
  return created
}

async function syncFinanceSheet(tenantId: string): Promise<Record<FinanceScope, string> | null> {
  const [mainId, pintarnyaId] = await Promise.all([ensureSpreadsheet(tenantId, 'all'), ensureSpreadsheet(tenantId, 'pintarnya')])
  if (!mainId || !pintarnyaId) return null // Google Sheets belum dikonfigurasi (mis. lokal)
  const { columns, groups } = await buildRecap(tenantId, '', '')
  // Link halaman invoice publik (sama dengan link preview bot /invoice); invoice tanpa kode akses dibuatkan
  const invoiceIds = groups.flatMap((g) => g.invoices.map((i) => i._id))
  const docs = await DocumentModel.find({ tenantId, _id: { $in: invoiceIds } }).select('accessCode')
  const linkOf = new Map<string, string>()
  for (const d of docs) {
    if (!d.accessCode) { d.accessCode = crypto.randomBytes(8).toString('hex'); await d.save() }
    linkOf.set(String(d._id), `${env.clientOrigin}/api/documents/${d._id}?code=${d.accessCode}`)
  }
  const headers = [
    ID_HEADER, 'ID Invoice', 'Campaign', 'Perusahaan', 'Contact', 'Bulan Running', 'Master Sheet', 'Item', 'Scope of Work', 'Jumlah Talent', 'Fee/Talent', 'Total',
    'Total Payment', 'Invoice', 'Link Invoice', 'Status', 'Tanggal Lunas', 'Jatuh Tempo', ...columns.map((c) => c.label),
    'Fee Creator', 'Fee PIC', 'Fee MG', 'Fee Handle by', 'Gaji Admin', 'Reimburse', 'Ads', 'Opex', 'Uang Keluar', 'Profit', 'Margin (%)',
  ]
  const shown = groups.filter((g) => !g.hidden)
  // 1 baris per SOW (sama dengan tabel platform). Data tingkat job (campaign, perusahaan, status, biaya, profit)
  // cuma di baris pertama, lalu sel-nya digabung per job seperti di platform, jadi batas antar job kelihatan dan
  // penjumlahan kolom tidak dobel. ID baris = "<id invoice,...>|<urutan SOW>" (unik per baris).
  const toRows = (g: (typeof groups)[number]): (string | number)[][] => {
    const e = g.expense
    const inv = g.invoices
    const items = g.items.length ? g.items : [null]
    return items.map((it, k) => {
      const first = k === 0
      const once = (v: number | string) => (first ? v : '')
      return [
        `${inv.map((i) => i._id).join(',')}|${k}`,
        ...[inv.map((i) => (i.shortId ? `#${i.shortId}` : '')).filter(Boolean).join(', '),
          g.campaign, g.company, g.contact, monthLabel(g.runningMonth), g.mastersheetUrl].map(once),
        it?.item ?? '', it?.sow ?? '', it?.qty ?? '', it?.unitFee ?? '', it?.amount ?? '',
        ...[g.totalInvoice,
          inv.map((i) => i.number).join('\n'),
          inv.map((i) => linkOf.get(i._id) ?? '').filter(Boolean).join('\n'),
          inv.every((i) => i.paid) ? 'Lunas' : 'Belum Lunas',
          inv.map((i) => i.paidAt).filter(Boolean).join('\n'),
          inv.map((i) => (i.dueDate ? `${i.dueDate}${i.overdue ? ' (lewat)' : ''}` : '')).filter(Boolean).join('\n')].map(once),
        ...columns.map((c) => once(g.custom[c.key] ?? '')),
        ...[e.feeCreator, e.feePic, e.feeMg, e.feeHandle, e.adminInternal, e.reimburse, e.ads, e.opex, e.total, g.profit].map(once),
        once(g.margin ?? ''),
      ]
    })
  }
  // Kelompok baris per job + kolom yang digabung: semua kecuali ID (unik per baris) & rincian SOW
  const RUPIAH = '"Rp"#,##0'
  const MONEY_HEADERS = new Set(['Fee/Talent', 'Total', 'Total Payment', 'Fee Creator', 'Fee PIC', 'Fee MG', 'Fee Handle by', 'Gaji Admin', 'Reimburse', 'Ads', 'Opex', 'Uang Keluar', 'Profit'])
  const SOW_COLS = new Set(['Item', 'Scope of Work', 'Jumlah Talent', 'Fee/Talent', 'Total'])
  const grouping = (list: typeof shown, width: number) => {
    let at = 0
    const ranges = list.map((g) => { const n = Math.max(g.items.length, 1); const r = { startRow: at, endRow: at + n - 1 }; at += n; return r })
    return { groups: ranges, mergeColumns: headers.slice(0, width).flatMap((h, i) => (i === 0 || SOW_COLS.has(h) ? [] : [i])) }
  }
  const all = shown.flatMap(toRows)
  // Sheet Pintarnya: tanpa kolom biaya internal (Fee Creator ke kanan: biaya, uang keluar, profit, margin)
  const cut = headers.indexOf('Fee Creator')
  const pintarnyaGroups = shown.filter((g) => isPintarnya(g.company))
  const pintarnya = pintarnyaGroups.flatMap((g) => toRows(g).map((r) => r.slice(0, cut)))
  // Dua tab, kolom sama: semua klien + khusus Pintarnya. Yang bisa diedit cuma Status & biaya.
  const statusCol = headers.indexOf('Status')
  const editable = [statusCol, ...Object.keys(FEE_HEADERS).map((h) => headers.indexOf(h))]
  const tab = (rows: (string | number)[][], head: string[], editableCols: number[], list: typeof shown): WorkbookTab => ({
    title: TAB, values: [head, ...rows], tableRows: rows.length + 1, hideFirstColumn: true,
    dropdowns: { [statusCol]: STATUS_OPTIONS }, editableColumns: editableCols, ...grouping(list, head.length),
    numberFormats: Object.fromEntries(head.flatMap((h, i) => (MONEY_HEADERS.has(h) || columns.some((c) => c.label === h && c.type !== 'text') ? [[i, RUPIAH]]
      : h === 'Jumlah Talent' ? [[i, '#,##0']] : []))),
  })
  const files: [FinanceScope, string, WorkbookTab][] = [
    ['all', mainId, tab(all, headers, editable, shown)],
    ['pintarnya', pintarnyaId, tab(pintarnya, headers.slice(0, cut), [statusCol], pintarnyaGroups)], // Pintarnya: cuma Status yang bisa diedit
  ]
  for (const [scope, id, t] of files) {
    await writeWorkbookTabs(id, [t])
    // Patokan polling cadangan (sel dianggap diedit orang kalau beda dari yang terakhir ditulis server)
    lastWritten.set(`${id}:${t.title}`, t.values)
    await ensureHook(tenantId, scope, id)
  }
  await deleteWorkbookTab(mainId, OLD_PINTARNYA_TAB).catch(() => undefined)
  return { all: mainId, pintarnya: pintarnyaId }
}

// Perubahan beruntun (tandai lunas beberapa invoice, edit biaya) digabung jadi satu tulis ulang
let timer: NodeJS.Timeout | undefined
let chain: Promise<unknown> = Promise.resolve()
export function scheduleFinanceSheetSync(tenantId: string): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    chain = chain.then(() => syncFinanceSheet(tenantId)).catch((err) => console.error('Sheet sync error (rekap keuangan):', (err as Error).message))
  }, 5000)
}

/** Dipanggil tombol "Buka Google Sheet": sinkron sekarang (spreadsheet dibuat kalau belum ada), balikin link tab. */
export async function openFinanceSheet(tenantId: string, scope: FinanceScope = 'all'): Promise<string | null> {
  const run = chain.then(() => syncFinanceSheet(tenantId))
  chain = run.catch(() => undefined)
  const ids = await run
  return ids ? getWorkbookTabUrl(ids[scope], TAB) : null
}

/** Pemicu onEdit Apps Script untuk spreadsheet ini (sekali); gagal = polling cadangan yang menangkap edit */
async function ensureHook(tenantId: string, scope: FinanceScope, spreadsheetId: string) {
  const { hookKey } = SCOPES[scope]
  const tenant = await Tenant.findById(tenantId).select(`settings.${hookKey}`)
  if (tenant?.settings?.[hookKey]) return
  if (await installSheetHook(spreadsheetId)) await Tenant.updateOne({ _id: tenantId }, { $set: { [`settings.${hookKey}`]: true } })
}

/** Spreadsheet Rekap Keuangan (semua + Pintarnya) untuk polling cadangan (sheetPoll.service.ts) */
export async function financeSheetTargets(tenantId: string): Promise<{ id: string; tabs: string[]; hooked: boolean }[]> {
  const tenant = await Tenant.findById(tenantId).select('settings')
  const st = tenant?.settings
  return (Object.values(SCOPES)).flatMap(({ idKey, hookKey }) => (st?.[idKey] ? [{ id: st[idKey]!, tabs: [TAB], hooked: !!st[hookKey] }] : []))
}

const num = (v: unknown) => { const t = String(v ?? '').replace(/[^\d-]/g, ''); return t === '' || t === '-' ? null : Number(t) }

/**
 * Edit satu baris di sheet Rekap Keuangan → platform. null = bukan spreadsheet Rekap Keuangan (biar handler
 * sheet campaign yang lanjut). Status → tandai lunas/belum semua invoice di baris itu; biaya → override manual
 * FinanceRecord campaign (sama dengan editor Uang Keluar). Kolom lain diabaikan (tertimpa sync berikutnya).
 */
export async function applyFinanceSheetRow(tenantId: string, spreadsheetId: string, row: Record<string, string | number | undefined>): Promise<string | null> {
  const targets = await financeSheetTargets(tenantId)
  if (!targets.some((t) => t.id === spreadsheetId)) return null
  const ids = String(row[ID_HEADER] ?? '').split('|')[0].split(',').map((x) => x.trim()).filter(Boolean)
  if (!ids.length) return 'skip: baris tanpa ID'
  const docs = await DocumentModel.find({ tenantId, type: 'invoice', _id: { $in: ids } })
  if (!docs.length) return 'skip: invoice tidak ditemukan'
  const done: string[] = []

  const status = String(row.Status ?? '').trim().toLowerCase()
  if (status === 'lunas' || status === 'belum lunas') {
    const paid = status === 'lunas'
    for (const d of docs) {
      const isPaid = (d.data.recap as InvoiceRecap | undefined)?.status === 'paid'
      if (isPaid !== paid) { await setPaid(d, paid); done.push(`#${d.shortId ?? '?'} ${paid ? 'lunas' : 'belum lunas'}`) }
    }
  }

  const campaignId = docs.map((d) => String((d.data.recap as InvoiceRecap | undefined)?.campaignId ?? '')).find(Boolean)
  if (!campaignId && docs.length === 1) {
    // Invoice tanpa campaign: biaya disimpan di invoice itu sendiri (sama dengan editor Uang Keluar)
    const { groups } = await buildRecap(tenantId, '', '')
    const g = groups.find((x) => x.invoices.some((i) => i._id === String(docs[0]._id)))
    const recap: InvoiceRecap = { ...((docs[0].data.recap || {}) as InvoiceRecap) }
    const expense = { ...(recap.expense || {}) }
    const changed: string[] = []
    for (const [h, field] of Object.entries(FEE_HEADERS)) {
      const v = num(row[h])
      if (v !== null && v !== g?.expense[field as keyof typeof g.expense]) { expense[field as keyof typeof expense] = v; changed.push(field) }
    }
    if (changed.length) {
      docs[0].data = { ...docs[0].data, recap: { ...recap, expense } }
      docs[0].markModified('data')
      await docs[0].save()
      done.push(`biaya invoice: ${changed.join(', ')}`)
    }
  }
  if (campaignId) {
    const { groups } = await buildRecap(tenantId, '', '')
    const g = groups.find((x) => x.invoices.some((i) => ids.includes(i._id)))
    const patch: Partial<Record<FeeField, number>> = {}
    for (const [h, field] of Object.entries(FEE_HEADERS)) {
      const v = num(row[h])
      const current = g?.expense[field as keyof typeof g.expense]
      if (v !== null && v !== current) patch[field] = v
    }
    if (Object.keys(patch).length) { await updateCampaignFinance(tenantId, campaignId, patch); done.push(`biaya: ${Object.keys(patch).join(', ')}`) }
  }
  if (done.length) scheduleFinanceSheetSync(tenantId)
  return done.length ? `rekap keuangan → ${done.join('; ')}` : 'skip: tidak ada perubahan'
}
