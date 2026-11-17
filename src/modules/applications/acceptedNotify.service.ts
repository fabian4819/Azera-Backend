import Creator from '../creators/creator.model'
import Campaign from '../campaigns/campaign.model'
import Application, { IApplication } from './application.model'
import { enqueueWaMessage } from '../../lib/baileys'
import { getTemplate, renderTemplate } from '../whatsapp/template.service'
import { sendEmail } from '../../lib/email'
import { creatorAcceptedEmail } from '../../lib/emailTemplates'
import { ensurePortalToken, portalUrl } from '../campaigns/progress.service'

const PLATFORM_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', threads: 'Threads', x: 'X' }
const BATCH_MS = 60_000
// ponytail: penundaan di memori, kalau server restart dalam 60 detik notif akun yang tertunda tidak terkirim;
// pindah ke cron yang menyapu acceptedNotifiedAt kosong kalau itu jadi masalah.
const pending = new Map<string, NodeJS.Timeout>()

/** Creator lolos DUA tahap (admin di tab Pendaftar, lalu client di dashboard client): kirim WA
 * creator_accepted + email berisi link dashboard campaign & link grup WA campaign. Lolos tahap 1
 * saja tidak dikirimi apa-apa. Campaign buzzer: akun-akun yang lolos dalam 60 detik digabung jadi
 * satu pesan per orang (approve massal tidak mengirim satu pesan per akun). */
export async function notifyCreatorAccepted(application: IApplication): Promise<void> {
  if (!application.accountKey) return sendAccepted([application])
  const key = `${application.campaignId}:${application.creatorId}`
  if (pending.has(key)) return
  pending.set(key, setTimeout(() => {
    pending.delete(key)
    void (async () => {
      const apps = await Application.find({
        tenantId: application.tenantId, campaignId: application.campaignId, creatorId: application.creatorId,
        status: 'accepted', clientApprovalStatus: 'accepted', acceptedNotifiedAt: { $exists: false },
      }).sort({ createdAt: 1 })
      if (apps.length) await sendAccepted(apps)
    })().catch((err) => console.error('Accepted notify error (buzzer):', err))
  }, BATCH_MS))
}

async function sendAccepted(apps: IApplication[]): Promise<void> {
  const first = apps[0]
  const [creator, campaign] = await Promise.all([
    Creator.findOne({ _id: first.creatorId, tenantId: first.tenantId }).select('name phone email'),
    Campaign.findOne({ _id: first.campaignId, tenantId: first.tenantId }),
  ])
  if (!creator || !campaign) return
  await Application.updateMany({ tenantId: first.tenantId, _id: { $in: apps.map((a) => a._id) } }, { acceptedNotifiedAt: new Date() })
  // Portal menampilkan semua baris akun milik creator ini, jadi satu link cukup
  const portalLink = portalUrl(await ensurePortalToken(first))
  const accounts = apps.filter((a) => a.account?.username).map((a) => `- ${PLATFORM_LABEL[a.account!.platform] ?? a.account!.platform} @${a.account!.username}`)
  if (creator.phone) {
    const template = await getTemplate(first.tenantId, 'creator_accepted')
    let payload = renderTemplate(template, { nama: creator.name, campaign: campaign.name, grup_link: campaign.waGroupLink, portal_link: portalLink })
    // Template lama (sudah di-seed/diedit sebelum ada {{portal_link}}) tetap harus bawa link-nya
    if (!template.includes('portal_link')) payload += `\n\nUpdate progress campaign kamu di sini: ${portalLink}`
    if (accounts.length) payload += `\n\nAkun yang lolos:\n${accounts.join('\n')}`
    await enqueueWaMessage({ tenantId: String(first.tenantId), trigger: 'creator_accepted', to: creator.phone, payload, campaignId: String(campaign._id), creatorId: String(creator._id) })
  }
  if (creator.email) {
    const mail = creatorAcceptedEmail(creator.name, campaign.name, portalLink, campaign.waGroupLink)
    await sendEmail(creator.email, mail.subject, mail.html)
  }
}
