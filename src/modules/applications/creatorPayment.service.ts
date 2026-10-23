import { Types } from 'mongoose'
import Application, { IApplication } from './application.model'
import Campaign from '../campaigns/campaign.model'
import Creator from '../creators/creator.model'
import { enqueueWaMessage } from '../../lib/baileys'
import { getTemplate, renderTemplate } from '../whatsapp/template.service'
import { isFullyApproved, syncApplicationToSheet } from '../../lib/sheetSync.service'

type Id = string | Types.ObjectId

/**
 * Ubah status bayar creator. Yang berubah unpaid → paid dapat WA payment_completed (AD-30).
 * Dipakai toggle per creator (Recap Payment / CampaignDetail) dan cascade saat PIC ditandai Lunas.
 */
export async function setCreatorPaymentStatus(tenantId: Id, applications: IApplication[], status: 'unpaid' | 'paid') {
  const changed = applications.filter((a) => a.creatorPaymentStatus !== status)
  if (!changed.length) return 0
  await Application.updateMany({ tenantId, _id: { $in: changed.map((a) => a._id) } }, { creatorPaymentStatus: status })
  for (const a of changed) a.creatorPaymentStatus = status

  if (status === 'paid') {
    const campaignIds = [...new Set(changed.map((a) => String(a.campaignId)))]
    const [campaigns, creators] = await Promise.all([
      Campaign.find({ tenantId, _id: { $in: campaignIds } }).select('name'),
      Creator.find({ tenantId, _id: { $in: changed.map((a) => a.creatorId) } }).select('name phone'),
    ])
    const template = await getTemplate(tenantId, 'payment_completed')
    for (const a of changed) {
      const creator = creators.find((c) => String(c._id) === String(a.creatorId))
      const campaign = campaigns.find((c) => String(c._id) === String(a.campaignId))
      if (!creator?.phone || !campaign) continue
      const payload = renderTemplate(template, { nama: creator.name, campaign: campaign.name })
      await enqueueWaMessage({ tenantId: String(tenantId), trigger: 'payment_completed', to: creator.phone, payload, campaignId: String(campaign._id) })
    }
  }
  for (const a of changed) syncApplicationToSheet(a).catch((err) => console.error('Sheet sync error (creator payment):', err))
  return changed.length
}

/** PIC ditandai Lunas → semua creator fully-approved di bawah PIC itu (campaign ini) ikut Lunas. */
export async function markPicCreatorsPaid(tenantId: Id, campaignId: Id, picUserId: Id) {
  const applications = (await Application.find({ tenantId, campaignId, picUserId })).filter(isFullyApproved)
  return setCreatorPaymentStatus(tenantId, applications, 'paid')
}

/** Minta info rekening ke creator fully-approved campaign ini, atau satu creator saja (applicationId). */
export async function requestBankInfoFromCreators(tenantId: Id, campaignId: Id, applicationId?: string) {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId })
  if (!campaign) throw new Error('Campaign tidak ditemukan')
  const applications = (await Application.find({ tenantId, campaignId })).filter(isFullyApproved)
    .filter((a) => !applicationId || String(a._id) === applicationId)
  if (applicationId && !applications.length) throw new Error('Creator ini tidak ada di Recap Payment campaign ini')
  const creators = await Creator.find({ tenantId, _id: { $in: applications.map((a) => a.creatorId) } })
  const template = await getTemplate(tenantId, 'creator_bank_info_request')
  const fee = `Rp${(campaign.fee?.creatorFee ?? 0).toLocaleString('id-ID')}`
  let sent = 0
  for (const creator of creators) {
    if (!creator.phone) continue
    const payload = renderTemplate(template, { nama: creator.name, campaign: campaign.name, fee })
    await enqueueWaMessage({ tenantId: String(tenantId), trigger: 'creator_bank_info_request', to: creator.phone, payload, campaignId: String(campaign._id), creatorId: String(creator._id) })
    // updateOne, bukan save(): data creator lama yang tidak lolos validasi skema tidak boleh menggagalkan kirim WA
    await Creator.updateOne({ _id: creator._id }, { $set: { paymentInfoRequestedAt: new Date() }, $unset: { pendingPaymentReply: 1 } })
    sent++
  }
  return sent
}
