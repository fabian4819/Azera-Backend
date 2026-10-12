import PicUser from './pic.model'
import Application from '../applications/application.model'
import Campaign from '../campaigns/campaign.model'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { enqueueWaMessage } from '../../lib/baileys'
import { getTemplate, renderTemplate } from '../whatsapp/template.service'
import { isFullyApproved } from '../../lib/sheetSync.service'

const normPhone = (p: string) => p.replace(/\D/g, '').replace(/^0/, '62')

/** AD-adjustment-6: admin klik tombol di Recap Payment, minta info bank/e-wallet ke tiap PIC
 * yang pegang creator fully-approved di campaign ini. */
export async function requestBankInfoFromPics(tenantId: string, campaignId: string): Promise<number> {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId })
  if (!campaign) throw new Error('Campaign tidak ditemukan')
  const applications = await Application.find({ tenantId, campaignId })
  const picIds = [...new Set(applications.filter(isFullyApproved).map((a) => a.picUserId).filter(Boolean).map(String))]
  if (!picIds.length) return 0
  const pics = await PicUser.find({ tenantId, _id: { $in: picIds } })
  const template = await getTemplate(tenantId, 'pic_bank_info_request')
  for (const pic of pics) {
    const payload = renderTemplate(template, { nama: pic.name, campaign: campaign.name })
    await enqueueWaMessage({ tenantId, trigger: 'pic_bank_info_request', to: pic.phone, payload, campaignId })
    pic.paymentInfoRequestedAt = new Date()
    pic.pendingPaymentReply = undefined
    await pic.save()
  }
  return pics.length
}

/** Dipanggil dari messages.upsert (baileys.ts) SEBELUM lead bot pipeline, supaya balasan PIC
 * (nomor pribadi, sedang ditunggu) tidak nyasar diproses sebagai lead. Simpan mentah, belum final
 * sampai admin konfirmasi manual (lihat confirmPaymentInfo di pic.routes.ts). Return true kalau
 * pesan ini "diserap" di sini (caller harus skip pipeline lain untuk pesan ini). */
export async function captureIncomingPicReply(phone: string, text: string): Promise<boolean> {
  const tenant = await getDefaultTenant()
  const pending = await PicUser.find({ tenantId: tenant._id, paymentInfoRequestedAt: { $exists: true, $ne: null } })
  const target = normPhone(phone)
  const pic = pending.find((p) => normPhone(p.phone) === target)
  if (!pic) return false
  pic.pendingPaymentReply = { raw: text, receivedAt: new Date() }
  await pic.save()
  return true
}
