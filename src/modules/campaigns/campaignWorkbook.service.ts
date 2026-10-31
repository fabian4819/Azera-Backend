import { Types } from 'mongoose'
import Campaign from './campaign.model'
import { buildSheetView, SheetKind } from './sheetView.service'
import { createCampaignWorkbook, writeWorkbookTabs, getWorkbookTabUrl } from '../../lib/googleSheets'

/** 1 campaign = 1 spreadsheet di Shared Drive, satu tab per tabel di halaman Sheet admin. */
export const WORKBOOK_TABS: Record<SheetKind, string> = {
  master: 'Master Sheet', applicants: 'Pendaftar', report: 'Report', recap: 'Recap Payment',
}
const RECAP_BY_PIC_TAB = 'Recap per PIC'
const TAB_ORDER = [WORKBOOK_TABS.master, WORKBOOK_TABS.applicants, WORKBOOK_TABS.report, WORKBOOK_TABS.recap, RECAP_BY_PIC_TAB]
const STATUS_LABEL: Record<string, string> = { pending: 'Pending', accepted: 'Approved', rejected: 'Rejected' }

type Cell = string | number
// tableRows = header + baris data (baris total di luar tabel Google Sheets)
const table = (headers: string[], rows: Cell[][], totals?: Cell[]) =>
  ({ values: [headers, ...rows, ...(totals ? [totals] : [])], tableRows: rows.length + 1 })

async function syncWorkbook(tenantId: string, campaignId: string): Promise<void> {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId }).select('name spreadsheetId')
  if (!campaign) return
  let spreadsheetId = campaign.spreadsheetId
  if (!spreadsheetId) {
    const created = await createCampaignWorkbook(`${campaign.name} | AZERA`, TAB_ORDER)
    if (!created) return // Google Sheets belum dikonfigurasi (mis. lokal)
    spreadsheetId = created
    await Campaign.updateOne({ _id: campaign._id }, { spreadsheetId })
  }
  const [master, applicants, report, recap] = await Promise.all(
    (['master', 'applicants', 'report', 'recap'] as SheetKind[]).map((k) => buildSheetView(tenantId, campaignId, k)),
  )
  if (!master || !applicants || !report || !recap) return
  await writeWorkbookTabs(spreadsheetId, [
    { title: WORKBOOK_TABS.master, ...table(master.headers, master.rows, master.totals) },
    {
      title: WORKBOOK_TABS.applicants,
      ...table([...applicants.headers, 'Status'], applicants.rows.map((r, i) => {
        const st = applicants.rowStatus?.[i] ?? ''
        return [...r, STATUS_LABEL[st] ?? st]
      })),
    },
    { title: WORKBOOK_TABS.report, ...table(report.headers, report.rows, report.totals) },
    { title: WORKBOOK_TABS.recap, ...table(recap.headers, recap.rows, recap.totals) },
    ...(recap.byPic ? [{ title: RECAP_BY_PIC_TAB, ...table(recap.byPic.headers, recap.byPic.rows, recap.byPic.totals) }] : []),
  ])
}

// Perubahan beruntun (pendaftar masuk barengan, approve massal, autosave form) digabung jadi satu tulis
// ulang per campaign. Proses tunggal (1 container API), jadi timer di memori cukup.
// Sync per campaign dijalankan berurutan (chain): dua sync paralel untuk campaign yang belum punya
// spreadsheet bisa sama-sama membuat file baru.
const timers = new Map<string, NodeJS.Timeout>()
const running = new Map<string, Promise<void>>()
export function scheduleWorkbookSync(tenantId: Types.ObjectId | string, campaignId: Types.ObjectId | string): void {
  const key = `${tenantId}:${campaignId}`
  clearTimeout(timers.get(key))
  timers.set(key, setTimeout(() => {
    timers.delete(key)
    const next = (running.get(key) ?? Promise.resolve())
      .then(() => syncWorkbook(String(tenantId), String(campaignId)))
      .catch((err) => console.error('Sheet sync error (workbook campaign):', (err as Error).message))
    running.set(key, next)
    void next.then(() => { if (running.get(key) === next) running.delete(key) })
  }, 3000))
}

/** Link tab di spreadsheet campaign; null kalau spreadsheet-nya belum dibuat. */
export function workbookTabUrl(spreadsheetId: string | undefined, kind: SheetKind): Promise<string | null> {
  return spreadsheetId ? getWorkbookTabUrl(spreadsheetId, WORKBOOK_TABS[kind]) : Promise.resolve(null)
}
