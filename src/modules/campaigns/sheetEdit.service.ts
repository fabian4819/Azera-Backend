import { Types } from 'mongoose'
import Campaign from './campaign.model'
import { getDefaultTenant } from '../tenants/defaultTenant'
import Application from '../applications/application.model'
import Submission from '../submissions/submission.model'
import { decideApplication, clientDecideApplication, type Decision } from '../applications/decision.service'
import { reviewSubmission } from './progress.service'
import { WORKBOOK_TABS, CLIENT_TABS, ID_HEADER, STATUS_LABEL, REVIEW_LABEL, REVIEW_NOTE_HEADER } from './campaignWorkbook.service'

const invert = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v.toLowerCase(), k]))
const STATUS_FROM_LABEL = invert(STATUS_LABEL) as Record<string, Decision>
const REVIEW_FROM_LABEL = invert(REVIEW_LABEL)
const REVIEW_HEADER: Record<'draft' | 'post', string> = { draft: 'Status Draft', post: 'Status Posting' }
// Revisi dipilih dari sheet sebelum catatannya diketik: tetap diterapkan (supaya tidak ditimpa sync berikutnya),
// catatan menyusul begitu kolom Catatan Revisi diisi.
const PENDING_NOTE = 'Diminta revisi dari Google Sheet (catatan menyusul)'

export type SheetRow = Record<string, string | number | undefined>

/**
 * Terapkan SATU baris yang diedit di spreadsheet campaign ke platform, lewat jalur yang sama dengan tombol
 * di dashboard. Isi baris = { header: nilai } termasuk kolom ID (application). Idempoten: baris yang
 * nilainya sudah sama dengan platform tidak melakukan apa-apa. Kolom lain di luar yang dikenali diabaikan
 * (sheet ditulis ulang dari platform di sync berikutnya, jadi edit liar di kolom lain hilang sendiri).
 */
export async function applySheetRow(spreadsheetId: string, tab: string, row: SheetRow): Promise<string> {
  const appId = String(row[ID_HEADER] ?? '').trim()
  if (!Types.ObjectId.isValid(appId)) return 'skip: tanpa ID'
  const tenant = await getDefaultTenant()
  const campaign = await Campaign.findOne({ tenantId: tenant._id, $or: [{ spreadsheetId }, { clientSpreadsheetId: spreadsheetId }] })
  if (!campaign) return 'skip: spreadsheet tidak dikenal'
  const isInternal = campaign.spreadsheetId === spreadsheetId
  const application = await Application.findOne({ _id: appId, tenantId: campaign.tenantId, campaignId: campaign._id })
  if (!application) return 'skip: baris tidak ditemukan'
  const label = (h: string) => String(row[h] ?? '').trim().toLowerCase()

  // Sheet internal, tab Pendaftar: keputusan tahap 1 (AZERA)
  if (isInternal && tab === WORKBOOK_TABS.applicants) {
    const status = STATUS_FROM_LABEL[label('Status')]
    if (!status || status === application.status) return 'skip: status sama'
    await decideApplication(campaign.tenantId, appId, status)
    return `tahap 1 → ${status}`
  }
  if (isInternal) return 'skip: tab internal lain'

  // Sheet external, tab Listing: keputusan tahap 2 (client)
  if (tab === CLIENT_TABS.listing) {
    const status = STATUS_FROM_LABEL[label('Status')]
    if (!status || status === application.clientApprovalStatus) return 'skip: status sama'
    const done = await clientDecideApplication(campaign.tenantId, campaign._id, appId, status)
    return done ? `tahap 2 → ${status}` : 'skip: belum lolos tahap 1'
  }

  // Sheet external, tab Campaign Tracker: review draft / posting oleh client
  if (tab === CLIENT_TABS.tracker) {
    const results: string[] = []
    for (const type of ['draft', 'post'] as const) {
      const wanted = REVIEW_FROM_LABEL[label(REVIEW_HEADER[type])]
      if (wanted !== 'approved' && wanted !== 'revision_requested') continue
      const sub = await Submission.findOne({ tenantId: campaign.tenantId, campaignId: campaign._id, creatorId: application.creatorId, type }).sort({ createdAt: -1 })
      if (!sub) continue
      const note = String(row[REVIEW_NOTE_HEADER[type]] ?? '').trim()
      const sameStatus = sub.status === wanted
      if (wanted === 'approved' && sameStatus) continue
      if (wanted === 'revision_requested' && sameStatus && (!note || note === sub.revisionNotes)) continue
      await reviewSubmission(
        { tenantId: campaign.tenantId, campaign, application, actor: 'admin', userId: application.creatorId },
        type, wanted, wanted === 'revision_requested' ? note || sub.revisionNotes || PENDING_NOTE : undefined,
      )
      results.push(`${type} → ${wanted}`)
    }
    return results.length ? results.join(', ') : 'skip: review sama'
  }
  return 'skip: tab tidak dikenal'
}
