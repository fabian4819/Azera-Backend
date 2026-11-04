import { Types } from 'mongoose'
import { ICampaign } from './campaign.model'
import Creator from '../creators/creator.model'
import PicUser from '../pic/pic.model'
import { IApplication } from '../applications/application.model'
import { markPicCreatorsPaid, setCreatorPaymentStatus } from '../applications/creatorPayment.service'
import { CellError } from './progress.service'
import { scheduleWorkbookSync } from './campaignWorkbook.service'

/** Edit sel Recap Payment (tab Creator & Rekap per PIC): dipakai dashboard admin (campaign.routes.ts) dan
 * edit langsung di Google Sheet (sheetEdit.service.ts), jadi aturan & efeknya sama persis. */
type Id = Types.ObjectId | string

const CREATOR_BANK_FIELDS = { bankName: 'bankName', accountNumber: 'accountNumber', accountName: 'accountName' } as const
export const RECAP_CREATOR_KEYS = new Set(['handleBy', 'bankName', 'accountNumber', 'accountName', 'npwp'])
export const RECAP_PIC_KEYS = new Set(['methodName', 'accountNumber', 'accountName'])

/** Tab Creator: Handle By (Application) atau rekening/NPWP (Creator). */
export async function setRecapCreatorCell(tenantId: Id, campaign: ICampaign, application: IApplication, key: string, value: string): Promise<void> {
  if (!RECAP_CREATOR_KEYS.has(key)) throw new CellError('Kolom ini tidak bisa diedit', 400)
  if (key === 'handleBy') {
    application.handleBy = value
    await application.save()
  } else {
    const creator = await Creator.findOne({ _id: application.creatorId, tenantId })
    if (!creator) throw new CellError('Creator tidak ditemukan', 404)
    if (key === 'npwp') creator.npwp = value
    else creator.bankAccount = { bankName: '', accountNumber: '', accountName: '', ...creator.bankAccount, [CREATOR_BANK_FIELDS[key as keyof typeof CREATOR_BANK_FIELDS]]: value }
    await creator.save()
  }
  scheduleWorkbookSync(tenantId, campaign._id)
}

/** Tab Creator: status bayar creator (Lunas / Belum Lunas). */
export async function setRecapCreatorPaid(tenantId: Id, application: IApplication, paid: boolean): Promise<number> {
  return setCreatorPaymentStatus(tenantId, [application], paid ? 'paid' : 'unpaid')
}

/** Rekap per PIC: info rekening/e-wallet PIC. */
export async function setRecapPicCell(tenantId: Id, campaign: ICampaign, picUserId: Id, key: string, value: string): Promise<void> {
  if (!RECAP_PIC_KEYS.has(key)) throw new CellError('Kolom ini tidak bisa diedit', 400)
  const pic = await PicUser.findOneAndUpdate(
    { _id: picUserId, tenantId },
    { $set: { [`paymentInfo.${key}`]: value, 'paymentInfo.updatedAt': new Date() } },
    { new: true },
  )
  if (!pic) throw new CellError('PIC tidak ditemukan', 404)
  scheduleWorkbookSync(tenantId, campaign._id)
}

/** Rekap per PIC: fee campaign ini sudah/belum dibayar ke PIC. Lunas → creator di bawahnya ikut Lunas
 * (batal Lunas tidak menarik balik status creator, bisa saja sudah dibayar terpisah). */
export async function setRecapPicPaid(tenantId: Id, campaign: ICampaign, picUserId: Id, paid: boolean): Promise<number> {
  const pic = await PicUser.findOneAndUpdate(
    { _id: picUserId, tenantId },
    paid ? { $addToSet: { paidCampaignIds: campaign._id } } : { $pull: { paidCampaignIds: campaign._id } },
    { new: true },
  )
  if (!pic) throw new CellError('PIC tidak ditemukan', 404)
  const creatorsMarkedPaid = paid ? await markPicCreatorsPaid(tenantId, campaign._id, pic._id) : 0
  scheduleWorkbookSync(tenantId, campaign._id)
  return creatorsMarkedPaid
}
