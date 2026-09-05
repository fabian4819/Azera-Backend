import cron from 'node-cron'
import { connectDB } from '../db/connect'
import Tenant from '../modules/tenants/tenant.model'
import Campaign from '../modules/campaigns/campaign.model'
import Brand from '../models/Brand'
import Invoice from '../modules/finance/invoice.model'
import Submission from '../modules/submissions/submission.model'
import { enqueueWaMessage } from './baileys'
import { getTemplate, renderTemplate } from '../modules/whatsapp/template.service'

const TIMEZONE = 'Asia/Jakarta'

// Daily progress report ditujukan ke tim internal (grup WhatsApp berisi bot + tim AzeraKOL),
// bukan ke brand — isi ID grup di .env, format JID grup: "xxxxxxxxxxxxxxxxx@g.us"
// (cara dapat ID-nya: kirim pesan apa saja di grup itu, lalu cek log server untuk baris "WA group message from ...").
const TEAM_GROUP_JID = process.env.WA_TEAM_GROUP_JID || ''

function daysUntil(date: Date): number {
  const ms = new Date(date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)
  return Math.round(ms / (24 * 60 * 60 * 1000))
}

const REMINDER_OFFSETS: Record<number, string> = { 7: 'H-7', 3: 'H-3', 1: 'H-1', 0: 'jatuh tempo hari ini' }

/** AD-31: reminder pembayaran client di H-7/H-3/H-1/hari-H, sekali per offset per invoice */
export async function runPaymentReminders() {
  await connectDB()
  const tenants = await Tenant.find()
  for (const tenant of tenants) {
    await runPaymentRemindersForTenant(String(tenant._id))
  }
}

async function runPaymentRemindersForTenant(tenantId: string) {
  const invoices = await Invoice.find({ tenantId, status: { $in: ['sent', 'waiting_verification'] } })
  for (const invoice of invoices) {
    const diff = daysUntil(invoice.dueDate)
    const offsetKey = [7, 3, 1, 0].find((d) => d === diff)
    if (offsetKey === undefined) continue
    const offsetLabel = REMINDER_OFFSETS[offsetKey]
    if (invoice.remindersSent.includes(offsetLabel)) continue

    const brand = await Brand.findById(invoice.brandId)
    const campaign = await Campaign.findById(invoice.campaignId)
    if (!brand?.whatsapp) continue

    const template = await getTemplate(invoice.tenantId, 'reminder_payment_client')
    const payload = renderTemplate(template, {
      bill_to: brand.namaBrand,
      invoice_number: invoice.number,
      campaign: campaign?.name || '-',
      due_label: offsetKey === 0 ? 'jatuh tempo hari ini' : `jatuh tempo dalam ${offsetKey} hari`,
      total: `Rp${invoice.total.toLocaleString('id-ID')}`,
      payment_link: `${process.env.CLIENT_ORIGIN || ''}/invoice/${invoice._id}?code=${invoice.accessCode}`,
    })
    await enqueueWaMessage({
      tenantId: String(invoice.tenantId), trigger: 'reminder_payment_client', to: brand.whatsapp, payload,
      campaignId: String(invoice.campaignId),
    })
    invoice.remindersSent.push(offsetLabel)
    await invoice.save()
  }
}

/** AD-31: daily progress report jam 17:00 ke tiap client dengan campaign aktif */
export async function runDailyProgressReport() {
  await connectDB()
  const tenants = await Tenant.find()
  for (const tenant of tenants) {
    await runDailyProgressReportForTenant(String(tenant._id))
  }
}

async function runDailyProgressReportForTenant(tenantId: string) {
  if (!TEAM_GROUP_JID) return // grup tim belum dikonfigurasi — skip diam-diam, bukan error tiap hari

  const campaigns = await Campaign.find({ tenantId, status: 'active' })
  for (const campaign of campaigns) {
    const submissions = await Submission.find({ tenantId: campaign.tenantId, campaignId: campaign._id })
    const draftCount = submissions.filter((s) => s.type === 'draft').length
    const approvedCount = submissions.filter((s) => s.status === 'approved').length
    const revisionCount = submissions.filter((s) => s.status === 'revision_requested').length
    const postedCount = submissions.filter((s) => s.type === 'post').length
    const insightCount = submissions.filter((s) => s.parsedInsight?.views !== undefined).length

    const template = await getTemplate(campaign.tenantId, 'daily_progress_report')
    const payload = renderTemplate(template, {
      campaign: campaign.name,
      tanggal: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
      draft_count: draftCount,
      approved_count: approvedCount,
      revision_count: revisionCount,
      posted_count: postedCount,
      insight_count: insightCount,
    })
    await enqueueWaMessage({
      tenantId: String(campaign.tenantId), trigger: 'daily_progress_report', to: TEAM_GROUP_JID, payload,
      campaignId: String(campaign._id),
    })
  }
}

export function startCronJobs() {
  cron.schedule('0 9 * * *', () => { runPaymentReminders().catch((err) => console.error('runPaymentReminders error:', err)) }, { timezone: TIMEZONE })
  cron.schedule('0 17 * * *', () => { runDailyProgressReport().catch((err) => console.error('runDailyProgressReport error:', err)) }, { timezone: TIMEZONE })
}
