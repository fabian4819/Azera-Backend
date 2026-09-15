import { ICreator } from '../modules/creators/creator.model'
import { IApplication } from '../modules/applications/application.model'
import { ISubmission } from '../modules/submissions/submission.model'
import Campaign from '../modules/campaigns/campaign.model'
import Creator from '../modules/creators/creator.model'
import Brand from '../models/Brand'
import { upsertCreatorRow, upsertApplicationRow, upsertSubmissionRow } from './googleSheets'

const GENDER_LABELS: Record<string, string> = {
  male: 'Laki-laki',
  female_hijab: 'Perempuan (Hijab)',
  female_non_hijab: 'Perempuan (Non-Hijab)',
}

const fmtDate = (d?: Date) => (d ? d.toLocaleDateString('id-ID') : '')

export function syncCreatorToSheet(creator: ICreator): Promise<void> {
  const maxFollowers = (creator.socials || []).reduce((max, s) => Math.max(max, s.followers || 0), 0)
  return upsertCreatorRow(String(creator._id), [
    creator.name,
    creator.phone,
    creator.email || '',
    creator.age ?? '',
    creator.gender ? GENDER_LABELS[creator.gender] : '',
    creator.domicile?.city || '',
    creator.domicile?.province || '',
    creator.niches?.join(', ') || '',
    creator.activities?.join(', ') || '',
    maxFollowers,
    creator.status,
    creator.complianceStatus,
    fmtDate(creator.createdAt),
  ])
}

export async function syncApplicationToSheet(application: IApplication): Promise<void> {
  const campaign = await Campaign.findById(application.campaignId)
  if (!campaign) return
  const [brand, creator] = await Promise.all([
    Brand.findById(campaign.brandId),
    Creator.findById(application.creatorId),
  ])
  await upsertApplicationRow(campaign.name, String(application._id), [
    brand?.namaBrand || '',
    creator?.name || '',
    application.status,
    application.curationResult,
    application.creatorPaymentStatus,
    fmtDate(application.createdAt),
  ])
}

export async function syncSubmissionToSheet(submission: ISubmission): Promise<void> {
  const campaign = await Campaign.findById(submission.campaignId)
  if (!campaign) return
  const creator = await Creator.findById(submission.creatorId)
  await upsertSubmissionRow(campaign.name, String(submission._id), [
    creator?.name || '',
    submission.type,
    submission.platform,
    submission.link || '',
    submission.status,
    submission.parsedInsight?.views ?? '',
    submission.parsedInsight?.likes ?? '',
    submission.parsedInsight?.comments ?? '',
    submission.parsedInsight?.shares ?? '',
    fmtDate(submission.createdAt),
  ])
}
