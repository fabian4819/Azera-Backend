import Tenant from '../tenants/tenant.model'
import { createCampaignWorkbook, writeWorkbookTabs, getWorkbookTabUrl, sharedDriveRootId } from '../../lib/googleSheets'
import { buildRecap } from './financeRecap.routes'

/**
 * Rekap Keuangan → spreadsheet "Rekap Keuangan | AZERA" di Shared Drive (menggantikan Export Excel).
 * Dua tab (semua klien + khusus Pintarnya), semua periode dalam satu Tabel (filter per bulan di Sheets), 1 baris per campaign/grup invoice supaya
 * jumlah per kolom tidak dobel; SOW digabung dalam satu sel. Tab dikunci: isinya ditulis ulang dari platform.
 */
const TAB = 'Rekap Keuangan'
// Tab kedua khusus klien Pintarnya (nama penagihan bervariasi: "Pintarnya", "PT Pintarnya Indonesia", "Pintarnya/ Pikopi")
const PINTARNYA_TAB = 'Pintarnya'
const isPintarnya = (company: string) => /pintarnya/i.test(company)
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
    'ID Invoice', 'Campaign', 'Perusahaan', 'Contact', 'Bulan Running', 'Master Sheet', 'SOW', 'Jumlah Talent',
    'Total Payment', 'Invoice', 'Status', 'Tanggal Lunas', 'Jatuh Tempo', ...columns.map((c) => c.label),
    'Fee Creator', 'Fee PIC', 'Fee MG', 'Fee Handle by', 'Gaji Admin', 'Reimburse', 'Ads', 'Opex', 'Uang Keluar', 'Profit', 'Margin (%)',
  ]
  const shown = groups.filter((g) => !g.hidden)
  const toRow = (g: (typeof groups)[number]) => {
    const e = g.expense
    const inv = g.invoices
    return [
      inv.map((i) => (i.shortId ? `#${i.shortId}` : '')).filter(Boolean).join(', '),
      g.campaign, g.company, g.contact, monthLabel(g.runningMonth), g.mastersheetUrl,
      g.items.map((it) => `${it.sow}${it.tier ? ` (${it.tier})` : ''} × ${it.qty}`).join('\n'),
      g.items.reduce((s, it) => s + it.qty, 0),
      g.totalInvoice,
      inv.map((i) => i.number).join('\n'),
      inv.every((i) => i.paid) ? 'Lunas' : inv.some((i) => i.overdue) ? 'Lewat Jatuh Tempo' : 'Belum Lunas',
      inv.map((i) => i.paidAt).filter(Boolean).join('\n'),
      inv.map((i) => i.dueDate).filter(Boolean).join('\n'),
      ...columns.map((c) => g.custom[c.key] ?? ''),
      e.feeCreator, e.feePic, e.feeMg, e.feeHandle, e.adminInternal, e.reimburse, e.ads, e.opex, e.total, g.profit, g.margin ?? '',
    ] as (string | number)[]
  }
  const all = shown.map(toRow)
  const pintarnya = shown.filter((g) => isPintarnya(g.company)).map(toRow)
  // Dua tab, kolom sama: semua klien + khusus Pintarnya
  await writeWorkbookTabs(spreadsheetId, [
    { title: TAB, values: [headers, ...all], tableRows: all.length + 1, editableColumns: [] },
    { title: PINTARNYA_TAB, values: [headers, ...pintarnya], tableRows: pintarnya.length + 1, editableColumns: [] },
  ])
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
