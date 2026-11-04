import Tenant from '../tenants/tenant.model'
import DocumentModel from '../documents/document.model'
import { createCampaignWorkbook, writeWorkbookTabs, getWorkbookTabUrl, sharedDriveRootId, type WorkbookTab } from '../../lib/googleSheets'
import { installSheetHook } from '../../lib/sheetHook'
import { buildRecap, type InvoiceRecap } from './financeRecap.routes'
import { updateCampaignFinance, type FeeField } from './financeRecord.routes'
import { setPaid } from './financeBot.service'
import { lastWritten, ID_HEADER } from '../campaigns/campaignWorkbook.service'
import { isPintarnyaClient } from './clientName'

/**
 * Rekap Keuangan → spreadsheet "Rekap Keuangan | AZERA" di Shared Drive (menggantikan Export Excel).
 * Dua tab (semua klien + khusus Pintarnya), semua periode dalam satu Tabel (filter per bulan di Sheets), 1 baris per campaign/grup invoice supaya
 * jumlah per kolom tidak dobel; SOW digabung dalam satu sel. Realtime dua arah: platform → sheet ditulis ulang
 * tiap perubahan; sheet → platform lewat Apps Script (applyFinanceSheetRow) untuk kolom Status & biaya saja,
 * kolom lain dikunci. Kolom A tersembunyi = ID invoice (Document) di baris itu.
 */
const TAB = 'Rekap Keuangan'
// Tab kedua khusus klien Pintarnya (nama penagihan bervariasi: "Pintarnya", "PT Pintarnya Indonesia", "Pintarnya/ Pikopi")
const PINTARNYA_TAB = 'Pintarnya'
const isPintarnya = isPintarnyaClient // termasuk "PDS Digital Agency"
const STATUS_OPTIONS = ['Lunas', 'Belum Lunas']
/** Kolom biaya yang bisa diedit dari sheet (baris yang terhubung ke campaign) → field FinanceRecord */
const FEE_HEADERS: Record<string, FeeField> = {
  'Fee Creator': 'feeCreator', 'Fee PIC': 'feePic', 'Fee MG': 'feeMg', 'Fee Handle by': 'feeHandle',
  'Gaji Admin': 'adminInternal', Reimburse: 'reimburse', Ads: 'ads', Opex: 'opex',
}
const monthLabel = (ym: string) => (ym ? new Date(`${ym}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '')

async function ensureSpreadsheet(tenantId: string): Promise<string | null> {
  const tenant = await Tenant.findById(tenantId).select('settings.financeRecapSpreadsheetId')
  const existing = tenant?.settings?.financeRecapSpreadsheetId
  if (existing) return existing
  const created = await createCampaignWorkbook('Rekap Keuangan | AZERA', [TAB], sharedDriveRootId())
  if (created) await Tenant.updateOne({ _id: tenantId }, { $set: { 'settings.financeRecapSpreadsheetId': created } })
  return created
}

async function syncFinanceSheet(tenantId: string): Promise<string | null> {
  const spreadsheetId = await ensureSpreadsheet(tenantId)
  if (!spreadsheetId) return null // Google Sheets belum dikonfigurasi (mis. lokal)
  const { columns, groups } = await buildRecap(tenantId, '', '')
  const headers = [
    ID_HEADER, 'ID Invoice', 'Campaign', 'Perusahaan', 'Contact', 'Bulan Running', 'Master Sheet', 'SOW', 'Jumlah Talent',
    'Total Payment', 'Invoice', 'Status', 'Tanggal Lunas', 'Jatuh Tempo', ...columns.map((c) => c.label),
    'Fee Creator', 'Fee PIC', 'Fee MG', 'Fee Handle by', 'Gaji Admin', 'Reimburse', 'Ads', 'Opex', 'Uang Keluar', 'Profit', 'Margin (%)',
  ]
  const shown = groups.filter((g) => !g.hidden)
  const toRow = (g: (typeof groups)[number]) => {
    const e = g.expense
    const inv = g.invoices
    return [
      inv.map((i) => i._id).join(','),
      inv.map((i) => (i.shortId ? `#${i.shortId}` : '')).filter(Boolean).join(', '),
      g.campaign, g.company, g.contact, monthLabel(g.runningMonth), g.mastersheetUrl,
      g.items.map((it) => `${it.sow}${it.tier ? ` (${it.tier})` : ''} × ${it.qty}`).join('\n'),
      g.items.reduce((s, it) => s + it.qty, 0),
      g.totalInvoice,
      inv.map((i) => i.number).join('\n'),
      inv.every((i) => i.paid) ? 'Lunas' : 'Belum Lunas',
      inv.map((i) => i.paidAt).filter(Boolean).join('\n'),
      inv.map((i) => (i.dueDate ? `${i.dueDate}${i.overdue ? ' (lewat)' : ''}` : '')).filter(Boolean).join('\n'),
      ...columns.map((c) => g.custom[c.key] ?? ''),
      e.feeCreator, e.feePic, e.feeMg, e.feeHandle, e.adminInternal, e.reimburse, e.ads, e.opex, e.total, g.profit, g.margin ?? '',
    ] as (string | number)[]
  }
  const all = shown.map(toRow)
  const pintarnya = shown.filter((g) => isPintarnya(g.company)).map(toRow)
  // Dua tab, kolom sama: semua klien + khusus Pintarnya. Yang bisa diedit cuma Status & biaya.
  const statusCol = headers.indexOf('Status')
  const editable = [statusCol, ...Object.keys(FEE_HEADERS).map((h) => headers.indexOf(h))]
  const tab = (title: string, rows: (string | number)[][]): WorkbookTab => ({
    title, values: [headers, ...rows], tableRows: rows.length + 1, hideFirstColumn: true,
    dropdowns: { [statusCol]: STATUS_OPTIONS }, editableColumns: editable,
  })
  const tabs = [tab(TAB, all), tab(PINTARNYA_TAB, pintarnya)]
  await writeWorkbookTabs(spreadsheetId, tabs)
  // Patokan polling cadangan (sel dianggap diedit orang kalau beda dari yang terakhir ditulis server)
  for (const t of tabs) lastWritten.set(`${spreadsheetId}:${t.title}`, t.values)
  await ensureHook(tenantId, spreadsheetId)
  return spreadsheetId
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
export async function openFinanceSheet(tenantId: string): Promise<string | null> {
  const run = chain.then(() => syncFinanceSheet(tenantId))
  chain = run.catch(() => undefined)
  const id = await run
  return id ? getWorkbookTabUrl(id, TAB) : null
}

/** Pemicu onEdit Apps Script untuk spreadsheet ini (sekali); gagal = polling cadangan yang menangkap edit */
async function ensureHook(tenantId: string, spreadsheetId: string) {
  const tenant = await Tenant.findById(tenantId).select('settings.financeRecapHooked')
  if (tenant?.settings?.financeRecapHooked) return
  if (await installSheetHook(spreadsheetId)) await Tenant.updateOne({ _id: tenantId }, { $set: { 'settings.financeRecapHooked': true } })
}

/** Spreadsheet Rekap Keuangan + tab-nya, untuk polling cadangan (sheetPoll.service.ts) */
export async function financeSheetTargets(tenantId: string): Promise<{ id: string; tabs: string[]; hooked: boolean } | null> {
  const tenant = await Tenant.findById(tenantId).select('settings.financeRecapSpreadsheetId settings.financeRecapHooked')
  const id = tenant?.settings?.financeRecapSpreadsheetId
  return id ? { id, tabs: [TAB, PINTARNYA_TAB], hooked: !!tenant?.settings?.financeRecapHooked } : null
}

const num = (v: unknown) => { const t = String(v ?? '').replace(/[^\d-]/g, ''); return t === '' || t === '-' ? null : Number(t) }

/**
 * Edit satu baris di sheet Rekap Keuangan → platform. null = bukan spreadsheet Rekap Keuangan (biar handler
 * sheet campaign yang lanjut). Status → tandai lunas/belum semua invoice di baris itu; biaya → override manual
 * FinanceRecord campaign (sama dengan editor Uang Keluar). Kolom lain diabaikan (tertimpa sync berikutnya).
 */
export async function applyFinanceSheetRow(tenantId: string, spreadsheetId: string, row: Record<string, string | number | undefined>): Promise<string | null> {
  const target = await financeSheetTargets(tenantId)
  if (!target || target.id !== spreadsheetId) return null
  const ids = String(row[ID_HEADER] ?? '').split(',').map((x) => x.trim()).filter(Boolean)
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
