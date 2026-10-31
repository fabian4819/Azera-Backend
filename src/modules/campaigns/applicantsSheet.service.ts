import { Types } from 'mongoose'
import { buildSheetView } from './sheetView.service'
import { replaceApplicantsTab } from '../../lib/googleSheets'

const STATUS_LABEL: Record<string, string> = { pending: 'Pending', accepted: 'Approved', rejected: 'Rejected' }

/** Tab "<campaign> - Pendaftar" di Google Sheets = tabel Pendaftar dashboard admin + kolom Status. */
async function syncApplicantsTab(tenantId: string, campaignId: string): Promise<void> {
  const view = await buildSheetView(tenantId, campaignId, 'applicants')
  if (!view) return
  const rows = view.rows.map((r, i) => [...r, STATUS_LABEL[view.rowStatus?.[i] ?? ''] ?? view.rowStatus?.[i] ?? ''])
  await replaceApplicantsTab(view.campaign.name, [[...view.headers, 'Status'], ...rows] as (string | number)[][])
}

// Banyak perubahan beruntun (pendaftar masuk barengan, approve massal) digabung jadi satu tulis ulang per campaign
const timers = new Map<string, NodeJS.Timeout>()
export function scheduleApplicantsSync(tenantId: Types.ObjectId | string, campaignId: Types.ObjectId | string): void {
  const key = `${tenantId}:${campaignId}`
  clearTimeout(timers.get(key))
  timers.set(key, setTimeout(() => {
    timers.delete(key)
    syncApplicantsTab(String(tenantId), String(campaignId)).catch((err) => console.error('Sheet sync error (pendaftar):', (err as Error).message))
  }, 3000))
}
