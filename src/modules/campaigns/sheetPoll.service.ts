import Campaign from './campaign.model'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { readWorkbookTabs } from '../../lib/googleSheets'
import { applySheetRow, type SheetRow } from './sheetEdit.service'
import { financeSheetTargets } from '../finance/financeSheet.service'
import { lastWritten, WORKBOOK_TABS, CLIENT_TABS, ID_HEADER, RECAP_BY_PIC } from './campaignWorkbook.service'

/**
 * Cadangan sinkron sheet → platform kalau pemicu Apps Script tidak ada (lewat batas 20 pemicu, skrip belum
 * dipasang) atau tidak jalan (mis. edit anonim lewat link). Spreadsheet tanpa pemicu dicek tiap 20 dtk,
 * yang berpemicu tiap 2 menit (jaring pengaman). Sel dianggap diedit orang kalau beda dari isi terakhir
 * yang ditulis server (lastWritten), bukan beda dari database.
 */
const FAST_MS = 20_000
const SAFETY_MS = 120_000
const lastPolled = new Map<string, number>()

const str = (v: unknown) => String(v ?? '').trim()
/** Server menulis angka mentah (1000), sheet dibaca balik berformat ("1,000"): anggap sama kalau nilainya sama */
const same = (a: unknown, b: unknown) => {
  const x = str(a), y = str(b)
  if (x === y) return true
  const nx = Number(x.replace(/,/g, '')), ny = Number(y.replace(/,/g, ''))
  return x !== '' && y !== '' && !Number.isNaN(nx) && nx === ny
}

async function pollSpreadsheet(spreadsheetId: string, tabs: string[]): Promise<void> {
  const read = await readWorkbookTabs(spreadsheetId, tabs)
  for (const tab of tabs) {
    const now = read[tab]
    if (!now?.length) continue
    const key = `${spreadsheetId}:${tab}`
    const before = lastWritten.get(key)
    if (!before) { lastWritten.set(key, now); continue } // patokan pertama (mis. setelah restart)
    const headers = now[0]
    const idCol = headers.indexOf(ID_HEADER)
    if (idCol < 0) continue
    const beforeById = new Map(before.slice(1).map((r) => [str(r[idCol]), r]))
    for (const r of now.slice(1)) {
      if (!str(r[idCol])) continue // baris total / kosong
      const old = beforeById.get(str(r[idCol]))
      if (!old) continue
      // Beda dari isi terakhir yang ditulis server = diedit orang; server yang memilah kolom mana yang diterapkan
      const changed = headers.some((_h, i) => i !== idCol && !same(r[i], old[i]))
      if (!changed) continue
      const row: SheetRow = Object.fromEntries(headers.map((h, i) => [h, r[i]]))
      const result = await applySheetRow(spreadsheetId, tab, row).catch((err) => `error: ${(err as Error).message}`)
      console.log(`Sheet poll [${tab}] ${str(r[idCol])}: ${result}`)
    }
    lastWritten.set(key, now)
  }
}

async function pollOnce(): Promise<void> {
  const tenant = await getDefaultTenant()
  const campaigns = await Campaign.find({ tenantId: tenant._id, status: { $nin: ['completed', 'cancelled'] }, spreadsheetId: { $exists: true } })
    .select('spreadsheetId clientSpreadsheetId sheetHooks')
  const now = Date.now()
  const finance = await financeSheetTargets(String(tenant._id))
  if (finance && now - (lastPolled.get(finance.id) ?? 0) >= (finance.hooked ? SAFETY_MS : FAST_MS)) {
    lastPolled.set(finance.id, now)
    await pollSpreadsheet(finance.id, finance.tabs).catch((err) => console.error(`Sheet poll error [rekap keuangan]:`, (err as Error).message))
  }
  for (const c of campaigns) {
    const targets: [string | undefined, string[]][] = [[c.spreadsheetId, [WORKBOOK_TABS.applicants, WORKBOOK_TABS.master, WORKBOOK_TABS.recap, RECAP_BY_PIC]], [c.clientSpreadsheetId, [CLIENT_TABS.listing, CLIENT_TABS.tracker]]]
    for (const [id, tabs] of targets) {
      if (!id) continue
      const every = c.sheetHooks?.includes(id) ? SAFETY_MS : FAST_MS
      if (now - (lastPolled.get(id) ?? 0) < every) continue
      lastPolled.set(id, now)
      await pollSpreadsheet(id, tabs).catch((err) => console.error(`Sheet poll error [${id}]:`, (err as Error).message))
    }
  }
}

let started = false
export function startSheetPolling(): void {
  if (started) return
  started = true
  let running = false
  setInterval(() => {
    if (running) return
    running = true
    pollOnce().catch((err) => console.error('Sheet poll error:', (err as Error).message)).finally(() => { running = false })
  }, FAST_MS)
}
