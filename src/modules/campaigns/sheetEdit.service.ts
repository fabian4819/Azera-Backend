import { Types } from 'mongoose'
import Campaign from './campaign.model'
import { getDefaultTenant } from '../tenants/defaultTenant'
import Application from '../applications/application.model'
import Submission from '../submissions/submission.model'
import { decideApplication, clientDecideApplication, type Decision } from '../applications/decision.service'
import { reviewSubmission, writeProgressCell, setPostingLink } from './progress.service'
import { buildSheetView } from './sheetView.service'
import { setRecapCreatorCell, setRecapCreatorPaid, setRecapPicCell, setRecapPicPaid, RECAP_CREATOR_KEYS, RECAP_PIC_KEYS } from './recapEdit.service'
import { paymentStatusLabel, campaignColumnLabel } from '../../lib/sheetSync.service'
import { applyFinanceSheetRow } from '../finance/financeSheet.service'
import { WORKBOOK_TABS, CLIENT_TABS, ID_HEADER, STATUS_LABEL, REVIEW_LABEL, REVIEW_NOTE_HEADER, RECAP_BY_PIC } from './campaignWorkbook.service'

const invert = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v.toLowerCase(), k]))
const STATUS_FROM_LABEL = invert(STATUS_LABEL) as Record<string, Decision>
const REVIEW_FROM_LABEL = invert(REVIEW_LABEL)
const REVIEW_HEADER: Record<'draft' | 'post', string> = { draft: 'Status Draft', post: 'Status Posting' }
// Revisi dipilih dari sheet sebelum catatannya diketik: tetap diterapkan (supaya tidak ditimpa sync berikutnya),
// catatan menyusul begitu kolom Catatan Revisi diisi.
const PENDING_NOTE = 'Diminta revisi dari Google Sheet (catatan menyusul)'

export type SheetRow = Record<string, string | number | undefined>

type Cell = string | number
const txt = (v: unknown) => String(v ?? '').trim()
/** Nilai sheet (tampilan) dianggap sama dengan platform: angka dibanding numerik ("1,000" = 1000). */
const sameCell = (sheet: string, platform: Cell) =>
  typeof platform === 'number' ? sheet !== '' && Number(sheet.replace(/,/g, '')) === platform : sheet === txt(platform)
const PAID = paymentStatusLabel(true).toLowerCase()
const UNPAID = paymentStatusLabel(false).toLowerCase()

/** Baris platform (view dashboard) dengan ID ini, untuk membandingkan sel mana yang benar-benar diedit di sheet. */
async function platformRow(tenantId: Types.ObjectId, campaignId: Types.ObjectId, kind: 'master' | 'recap', id: string, byPic = false) {
  const view = await buildSheetView(tenantId, String(campaignId), kind)
  const t = byPic ? view?.byPic : view
  const i = t?.rowIds?.indexOf(id) ?? -1
  return t && i >= 0 ? { headers: t.headers, row: t.rows[i], columns: t.columns ?? [] } : null
}

/**
 * Terapkan SATU baris yang diedit di spreadsheet campaign ke platform, lewat jalur yang sama dengan tombol
 * di dashboard. Isi baris = { header: nilai } termasuk kolom ID (application). Idempoten: baris yang
 * nilainya sudah sama dengan platform tidak melakukan apa-apa. Kolom lain di luar yang dikenali diabaikan
 * (sheet ditulis ulang dari platform di sync berikutnya, jadi edit liar di kolom lain hilang sendiri).
 */
export async function applySheetRow(spreadsheetId: string, tab: string, row: SheetRow): Promise<string> {
  const tenant = await getDefaultTenant()
  // Spreadsheet Rekap Keuangan (bukan sheet campaign): ID baris = daftar invoice
  const finance = await applyFinanceSheetRow(String(tenant._id), spreadsheetId, row)
  if (finance !== null) return finance
  const appId = String(row[ID_HEADER] ?? '').trim()
  if (!Types.ObjectId.isValid(appId)) return 'skip: tanpa ID'
  const campaign = await Campaign.findOne({ tenantId: tenant._id, $or: [{ spreadsheetId }, { clientSpreadsheetId: spreadsheetId }] })
  if (!campaign) return 'skip: spreadsheet tidak dikenal'
  const isInternal = campaign.spreadsheetId === spreadsheetId

  // Sheet internal, Recap per PIC: ID baris = PIC (bukan application). Rekening/e-wallet + Status Pembayaran
  if (isInternal && tab === RECAP_BY_PIC) {
    const current = await platformRow(campaign.tenantId, campaign._id, 'recap', appId, true)
    if (!current) return 'skip: PIC tidak ada di rekap'
    const done: string[] = []
    for (const [i, col] of current.columns.entries()) {
      const sheet = txt(row[current.headers[i]])
      if (sameCell(sheet, current.row[i])) continue
      if (RECAP_PIC_KEYS.has(col.key)) { await setRecapPicCell(campaign.tenantId, campaign, appId, col.key, sheet); done.push(col.key) }
      else if (col.key === 'paymentStatus' && [PAID, UNPAID].includes(sheet.toLowerCase())) {
        await setRecapPicPaid(campaign.tenantId, campaign, appId, sheet.toLowerCase() === PAID); done.push('paymentStatus')
      }
    }
    return done.length ? `rekap PIC → ${done.join(', ')}` : 'skip: tidak ada perubahan'
  }

  const application = await Application.findOne({ _id: appId, tenantId: campaign.tenantId, campaignId: campaign._id })
  if (!application) return 'skip: baris tidak ditemukan'
  const label = (h: string) => String(row[h] ?? '').trim().toLowerCase()

  // Sheet internal, tab Pendaftar: keputusan tahap 1 (AZERA)
  if (isInternal && tab === WORKBOOK_TABS.applicants) {
    // Skema "langsung ke client": Status di sini cuma cerminan keputusan client, tidak diterapkan
    if (campaign.approvalFlow === 'client_only') return 'skip: diputuskan client'
    const status = STATUS_FROM_LABEL[label('Status')]
    if (!status || status === application.status) return 'skip: status sama'
    await decideApplication(campaign.tenantId, appId, status)
    return `tahap 1 → ${status}`
  }
  // Sheet internal, Master Sheet: kolom progress (teks/angka/tanggal/link) & Link Posting. Kolom upload
  // (draft, screenshot) & kolom hitungan tidak bisa dari sheet, edit di sana tertimpa sync berikutnya.
  if (isInternal && tab === WORKBOOK_TABS.master) {
    const current = await platformRow(campaign.tenantId, campaign._id, 'master', appId)
    if (!current) return 'skip: belum lolos 2 tahap'
    const ctx = { tenantId: campaign.tenantId, campaign, application, actor: 'admin' as const, userId: campaign.picUserId ?? application.creatorId }
    const done: string[] = []
    for (const [i, col] of current.columns.entries()) {
      const sheet = txt(row[current.headers[i]])
      if (sameCell(sheet, current.row[i])) continue
      if (col.progressId && col.kind && !['file', 'media'].includes(col.kind)) {
        await writeProgressCell({ ...ctx, columnId: col.progressId }, sheet); done.push(current.headers[i])
      } else if (col.submission?.type === 'post' && !col.submission.review) {
        await setPostingLink(ctx, sheet); done.push(current.headers[i])
      }
    }
    return done.length ? `master → ${done.join(', ')}` : 'skip: tidak ada perubahan'
  }

  // Sheet internal, Recap Payment (tab Creator): rekening/NPWP/Handle By + Status Pembayaran
  if (isInternal && tab === WORKBOOK_TABS.recap) {
    const current = await platformRow(campaign.tenantId, campaign._id, 'recap', appId)
    if (!current) return 'skip: belum lolos 2 tahap'
    const done: string[] = []
    for (const [i, col] of current.columns.entries()) {
      const sheet = txt(row[current.headers[i]])
      if (sameCell(sheet, current.row[i])) continue
      if (RECAP_CREATOR_KEYS.has(col.key)) { await setRecapCreatorCell(campaign.tenantId, campaign, application, col.key, sheet); done.push(col.key) }
      else if (col.key === 'paymentStatus' && [PAID, UNPAID].includes(sheet.toLowerCase())) {
        await setRecapCreatorPaid(campaign.tenantId, application, sheet.toLowerCase() === PAID); done.push('paymentStatus')
      }
    }
    return done.length ? `recap → ${done.join(', ')}` : 'skip: tidak ada perubahan'
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
      const wanted = REVIEW_FROM_LABEL[label(campaignColumnLabel(campaign, REVIEW_HEADER[type]))]
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
