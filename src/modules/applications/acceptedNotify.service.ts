import Creator from '../creators/creator.model'
import Campaign from '../campaigns/campaign.model'
import { IApplication } from './application.model'
import { enqueueWaMessage } from '../../lib/baileys'
import { getTemplate, renderTemplate } from '../whatsapp/template.service'
import { sendEmail } from '../../lib/email'
import { creatorAcceptedEmail } from '../../lib/emailTemplates'
import { ensurePortalToken, portalUrl } from '../campaigns/progress.service'

/** Creator lolos DUA tahap (admin di tab Pendaftar, lalu client di dashboard client): kirim WA
 * creator_accepted + email berisi link dashboard campaign & link grup WA campaign. Lolos tahap 1
 * saja tidak dikirimi apa-apa. */
export async function notifyCreatorAccepted(application: IApplication): Promise<void> {
  const [creator, campaign] = await Promise.all([
    Creator.findOne({ _id: application.creatorId, tenantId: application.tenantId }).select('name phone email'),
    Campaign.findOne({ _id: application.campaignId, tenantId: application.tenantId }),
  ])
  if (!creator || !campaign) return
  const portalLink = portalUrl(await ensurePortalToken(application))
  if (creator.phone) {
    const template = await getTemplate(application.tenantId, 'creator_accepted')
    let payload = renderTemplate(template, { nama: creator.name, campaign: campaign.name, grup_link: campaign.waGroupLink, portal_link: portalLink })
    // Template lama (sudah di-seed/diedit sebelum ada {{portal_link}}) tetap harus bawa link-nya
    if (!template.includes('portal_link')) payload += `\n\nUpdate progress campaign kamu di sini: ${portalLink}`
    await enqueueWaMessage({ tenantId: String(application.tenantId), trigger: 'creator_accepted', to: creator.phone, payload, campaignId: String(campaign._id), creatorId: String(creator._id) })
  }
  if (creator.email) {
    const mail = creatorAcceptedEmail(creator.name, campaign.name, portalLink, campaign.waGroupLink)
    await sendEmail(creator.email, mail.subject, mail.html)
  }
}
