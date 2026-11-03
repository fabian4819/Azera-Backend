import { Types } from 'mongoose'
import Campaign from './campaign.model'
import { buildSheetView, buildClientApplicantsView, buildPortalView, SheetKind } from './sheetView.service'
import { createCampaignWorkbook, createCampaignFolder, moveDriveFile, writeWorkbookTabs, getWorkbookTabUrl, shareAnyoneCanEdit, type WorkbookTab } from '../../lib/googleSheets'
import { installSheetHook, uninstallSheetHook } from '../../lib/sheetHook'

/** 1 campaign = 1 spreadsheet di Shared Drive, satu tab per tabel di halaman Sheet admin. */
export const WORKBOOK_TABS: Record<SheetKind, string> = {
  master: 'Master Sheet', applicants: 'Pendaftar', report: 'Report', recap: 'Recap Payment',
}
const RECAP_BY_PIC_TAB = 'Recap per PIC'
const TAB_ORDER = [WORKBOOK_TABS.master, WORKBOOK_TABS.applicants, WORKBOOK_TABS.report, WORKBOOK_TABS.recap, RECAP_BY_PIC_TAB]
export const STATUS_LABEL: Record<string, string> = { pending: 'Pending', accepted: 'Approved', rejected: 'Rejected' }
export const STATUS_OPTIONS = ['Pending', 'Approved', 'Rejected']
/** Status review draft/posting (Submission.status) ↔ label dropdown di sheet external */
export const REVIEW_LABEL: Record<string, string> = { submitted: 'Menunggu Review', approved: 'Approved', revision_requested: 'Revisi' }
export const REVIEW_OPTIONS = ['Menunggu Review', 'Approved', 'Revisi']
/** Sheet EXTERNAL (client): nama tab & kolom yang bisa diedit client */
export const CLIENT_TABS = { listing: 'Listing', tracker: 'Campaign Tracker' } as const
export const ID_HEADER = 'ID'
export const REVIEW_NOTE_HEADER: Record<'draft' | 'post', string> = { draft: 'Catatan Revisi Draft', post: 'Catatan Revisi Posting' }

type Cell = string | number
// tableRows = header + baris data (baris total di luar tabel Google Sheets)
const table = (headers: string[], rows: Cell[][], totals?: Cell[]) =>
  ({ values: [headers, ...rows, ...(totals ? [totals] : [])], tableRows: rows.length + 1 })

/** Isi terakhir yang DITULIS server per (spreadsheet, tab): polling cadangan menganggap sel diedit orang
 * cuma kalau nilainya beda dari sini, jadi perubahan dari platform yang belum sempat tersinkron tidak
 * ikut "dikembalikan" ke nilai lama sheet. ponytail: di memori, hilang saat restart (polling pertama
 * setelah restart cuma mengambil patokan, edit di sheet selama server mati tidak terbaca polling;
 * pemicu Apps Script tetap menangkapnya). */
export const lastWritten = new Map<string, (string | number)[][]>()
const remember = (spreadsheetId: string, tabs: WorkbookTab[]) => {
  for (const t of tabs) if (t.hideFirstColumn) lastWritten.set(`${spreadsheetId}:${t.title}`, t.values)
}

/** Tab dengan kolom A = ID application (tersembunyi), dipakai Apps Script mencocokkan baris yang diedit */
const withIds = (headers: string[], rows: Cell[][], ids: string[]) => table([ID_HEADER, ...headers], rows.map((r, i) => [ids[i] ?? '', ...r]))

/** Sheet external: Listing (lolos tahap 1, Status = keputusan client) + Campaign Tracker (progress, review
 * draft/posting + catatan revisi bisa diedit). Data internal (WA, email, PIC, handle by) sudah dibuang di view-nya. */
async function clientTabs(tenantId: string, campaignId: string): Promise<WorkbookTab[] | null> {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId })
  if (!campaign) return null
  const [listing, board] = await Promise.all([buildClientApplicantsView(tenantId, campaign), buildPortalView(tenantId, campaign, { role: 'client' })])
  const listingTab = withIds([...listing.headers, 'Status'], listing.rows.map((r, i) => [...r, STATUS_LABEL[listing.rowStatus?.[i] ?? ''] ?? '']), listing.rowIds ?? [])
  const listingStatusCol = listingTab.values[0].length - 1

  // Tracker: tiap kolom status review diikuti kolom catatan revisinya
  const headers: string[] = []
  const reviewCols: number[] = []
  const noteCols: number[] = []
  board.headers.forEach((h, i) => {
    headers.push(h)
    const review = board.columns[i]?.review
    if (review) {
      reviewCols.push(headers.length) // +1 kolom ID di depan
      headers.push(REVIEW_NOTE_HEADER[review])
      noteCols.push(headers.length)
    }
  })
  const rows = board.rows.map((r) => r.cells.flatMap((cell, i) => {
    const review = board.columns[i]?.review
    if (!review) return [cell]
    const note = review === 'draft' ? r.notes?.draft : r.notes?.post
    return [REVIEW_LABEL[String(cell)] ?? cell, cell === 'revision_requested' ? note || '' : '']
  }))
  const trackerTab = withIds(headers, rows, board.rows.map((r) => r.id))
  return [
    { title: CLIENT_TABS.listing, ...listingTab, hideFirstColumn: true, dropdowns: { [listingStatusCol]: STATUS_OPTIONS }, editableColumns: [listingStatusCol] },
    {
      title: CLIENT_TABS.tracker, ...trackerTab, hideFirstColumn: true,
      dropdowns: Object.fromEntries(reviewCols.map((c) => [c, REVIEW_OPTIONS])), editableColumns: [...reviewCols, ...noteCols],
    },
  ]
}

async function syncWorkbook(tenantId: string, campaignId: string): Promise<void> {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId }).select('name spreadsheetId driveFolderId clientSpreadsheetId sheetHooks')
  if (!campaign) return
  // Shared Drive: 1 folder per campaign, spreadsheet di dalamnya (bukan langsung di root)
  let folderId = campaign.driveFolderId
  if (!folderId) {
    const created = await createCampaignFolder(campaign.name)
    if (!created) return // Google Sheets belum dikonfigurasi (mis. lokal)
    folderId = created
    await Campaign.updateOne({ _id: campaign._id }, { driveFolderId: folderId })
    // Spreadsheet yang terlanjur dibuat di root (sebelum ada folder per campaign) dipindah ke folder ini
    if (campaign.spreadsheetId) await moveDriveFile(campaign.spreadsheetId, folderId)
  }
  let spreadsheetId = campaign.spreadsheetId
  if (!spreadsheetId) {
    const created = await createCampaignWorkbook(`${campaign.name} | AZERA`, TAB_ORDER, folderId)
    if (!created) return
    spreadsheetId = created
    await Campaign.updateOne({ _id: campaign._id }, { spreadsheetId })
  }
  const [master, applicants, report, recap] = await Promise.all(
    (['master', 'applicants', 'report', 'recap'] as SheetKind[]).map((k) => buildSheetView(tenantId, campaignId, k)),
  )
  if (!master || !applicants || !report || !recap) return
  const internalTabs: WorkbookTab[] = [
    { title: WORKBOOK_TABS.master, ...table(master.headers, master.rows, master.totals) },
    {
      // Kolom Status bisa diubah tim AZERA langsung di sheet (= approve tahap 1), disinkron balik lewat Apps Script
      title: WORKBOOK_TABS.applicants,
      ...withIds([...applicants.headers, 'Status'], applicants.rows.map((r, i) => {
        const st = applicants.rowStatus?.[i] ?? ''
        return [...r, STATUS_LABEL[st] ?? st]
      }), applicants.rowIds ?? []),
      hideFirstColumn: true,
      dropdowns: { [applicants.headers.length + 1]: STATUS_OPTIONS },
    },
    { title: WORKBOOK_TABS.report, ...table(report.headers, report.rows, report.totals) },
    { title: WORKBOOK_TABS.recap, ...table(recap.headers, recap.rows, recap.totals) },
    ...(recap.byPic ? [{ title: RECAP_BY_PIC_TAB, ...table(recap.byPic.headers, recap.byPic.rows, recap.byPic.totals) }] : []),
  ]
  await writeWorkbookTabs(spreadsheetId, internalTabs)
  remember(spreadsheetId, internalTabs)

  // Sheet EXTERNAL untuk client, di folder campaign yang sama, terbuka untuk siapa saja yang punya link
  let clientSpreadsheetId = campaign.clientSpreadsheetId
  if (!clientSpreadsheetId) {
    const created = await createCampaignWorkbook(`${campaign.name} | Client`, [CLIENT_TABS.listing, CLIENT_TABS.tracker], folderId)
    if (!created) return
    clientSpreadsheetId = created
    await Campaign.updateOne({ _id: campaign._id }, { clientSpreadsheetId })
    await shareAnyoneCanEdit(clientSpreadsheetId)
  }
  const ext = await clientTabs(tenantId, campaignId)
  if (ext) {
    await writeWorkbookTabs(clientSpreadsheetId, ext)
    remember(clientSpreadsheetId, ext)
  }

  // Pemicu Apps Script (sinkron realtime sheet → platform), sekali per spreadsheet
  const hooked = new Set(campaign.sheetHooks || [])
  for (const id of [spreadsheetId, clientSpreadsheetId]) {
    if (hooked.has(id)) continue
    if (await installSheetHook(id)) await Campaign.updateOne({ _id: campaign._id }, { $addToSet: { sheetHooks: id } })
  }
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

/** Campaign selesai / dibatalkan / dihapus: lepas pemicu Apps Script supaya jatah 20 pemicu dipakai campaign aktif. */
export async function releaseSheetHooks(campaign: { _id: unknown; sheetHooks?: string[] }): Promise<void> {
  for (const id of campaign.sheetHooks || []) await uninstallSheetHook(id)
  if (campaign.sheetHooks?.length) await Campaign.updateOne({ _id: campaign._id }, { $unset: { sheetHooks: 1 } })
}
