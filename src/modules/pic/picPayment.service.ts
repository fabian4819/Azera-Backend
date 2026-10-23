import PicUser from './pic.model'
import Creator from '../creators/creator.model'
import Application from '../applications/application.model'
import Campaign from '../campaigns/campaign.model'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { enqueueWaMessage } from '../../lib/baileys'
import { getTemplate, renderTemplate } from '../whatsapp/template.service'
import { isFullyApproved } from '../../lib/sheetSync.service'

const normPhone = (p: string) => p.replace(/\D/g, '').replace(/^0/, '62')

/** AD-adjustment-6: admin klik tombol di Recap Payment, minta info bank/e-wallet ke tiap PIC
 * yang pegang creator fully-approved di campaign ini, atau ke satu PIC saja (picUserId). */
export async function requestBankInfoFromPics(tenantId: string, campaignId: string, picUserId?: string): Promise<number> {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId })
  if (!campaign) throw new Error('Campaign tidak ditemukan')
  const applications = (await Application.find({ tenantId, campaignId })).filter(isFullyApproved)
  const counts = new Map<string, number>()
  for (const a of applications) if (a.picUserId) counts.set(String(a.picUserId), (counts.get(String(a.picUserId)) || 0) + 1)
  if (picUserId && !counts.has(picUserId)) throw new Error('PIC ini tidak pegang creator di campaign ini')
  const picIds = picUserId ? [picUserId] : [...counts.keys()]
  if (!picIds.length) return 0
  const pics = await PicUser.find({ tenantId, _id: { $in: picIds } })
  const template = await getTemplate(tenantId, 'pic_bank_info_request')
  const picFee = campaign.fee?.picFee ?? 0
  for (const pic of pics) {
    const count = counts.get(String(pic._id)) || 0
    const payload = renderTemplate(template, {
      nama: pic.name, campaign: campaign.name, jumlah_creator: count, fee: `Rp${(picFee * count).toLocaleString('id-ID')}`,
    })
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
  return (await capturePic(phone, text)) || (await captureCreator(phone, text))
}

/** Balasan creator atas permintaan info rekening (Recap Payment tab Creator), disimpan mentah. Hanya 7 hari
 * setelah permintaan, supaya chat creator berikutnya tetap masuk ke bot creator seperti biasa. */
const CREATOR_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
async function captureCreator(phone: string, text: string): Promise<boolean> {
  const tenant = await getDefaultTenant()
  const pending = await Creator.find({ tenantId: tenant._id, paymentInfoRequestedAt: { $gte: new Date(Date.now() - CREATOR_REPLY_WINDOW_MS) } }).select('phone pendingPaymentReply')
  const target = normPhone(phone)
  const creator = pending.find((c) => c.phone && normPhone(c.phone) === target)
  if (!creator) return false
  await Creator.updateOne({ _id: creator._id }, { $set: { pendingPaymentReply: { raw: text, receivedAt: new Date() } } })
  return true
}

async function capturePic(phone: string, text: string): Promise<boolean> {
  const tenant = await getDefaultTenant()
  const pending = await PicUser.find({ tenantId: tenant._id, paymentInfoRequestedAt: { $exists: true, $ne: null } })
  const target = normPhone(phone)
  const pic = pending.find((p) => normPhone(p.phone) === target)
  if (!pic) return false
  pic.pendingPaymentReply = { raw: text, receivedAt: new Date() }
  await pic.save()
  return true
}
