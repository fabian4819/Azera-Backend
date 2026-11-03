import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { Types } from 'mongoose'
import Application, { IApplication } from './application.model'
import Creator from '../creators/creator.model'
import { syncApplicationToSheet } from '../../lib/sheetSync.service'
import { ensurePortalToken } from '../campaigns/progress.service'
import { notifyCreatorAccepted } from './acceptedNotify.service'

export type Decision = 'accepted' | 'rejected' | 'pending'

/** Tahap 1 (admin AZERA), dari tab Pendaftar platform ATAU kolom Status sheet internal. Lolos = magic
 * link dibuat + akun Talent Portal disiapkan, tapi notif ke creator baru setelah tahap 2 (client). */
export async function decideApplication(
  tenantId: Types.ObjectId | string, applicationId: string, status: Decision, userId?: string,
): Promise<{ application: IApplication; generatedPassword?: string } | null> {
  const application = await Application.findOneAndUpdate(
    { _id: applicationId, tenantId },
    { status, decidedByUserId: userId, decidedAt: new Date() },
    { new: true },
  ).populate('creatorId').populate('picUserId', 'name email')
  if (!application) return null
  let generatedPassword: string | undefined
  if (status === 'accepted') {
    const creator = await Creator.findOne({ _id: application.creatorId, tenantId })
    if (creator && !creator.password) {
      generatedPassword = crypto.randomBytes(4).toString('hex')
      creator.password = await bcrypt.hash(generatedPassword, 12)
      await creator.save()
    }
    await ensurePortalToken(application)
  }
  syncApplicationToSheet(application).catch((err) => console.error('Sheet sync error (application):', err))
  return { application, generatedPassword }
}

/** Tahap 2 (client), dari tab Listing portal client ATAU sheet external. Hanya untuk yang lolos tahap 1.
 * Pertama kali jadi 'accepted' = creator dikabari (WA + email), sekali saja. */
export async function clientDecideApplication(
  tenantId: Types.ObjectId | string, campaignId: Types.ObjectId | string, applicationId: string, status: Decision,
): Promise<IApplication | null> {
  // `new: false` = sebelum update, supaya notif lolos cuma terkirim sekali (bukan tiap klik approve ulang)
  const before = await Application.findOneAndUpdate(
    { _id: applicationId, tenantId, campaignId, status: 'accepted' },
    { clientApprovalStatus: status },
    { new: false },
  )
  if (!before) return null
  const application = (await Application.findById(before._id))!
  syncApplicationToSheet(application).catch((err) => console.error('Sheet sync error (client approval):', err))
  if (status === 'accepted' && before.clientApprovalStatus !== 'accepted') {
    notifyCreatorAccepted(application).catch((err) => console.error('Accepted notify error:', err))
  }
  return application
}
