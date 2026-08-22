import { Types } from 'mongoose'
import { ICampaign } from '../campaigns/campaign.model'
import { ICreator } from '../creators/creator.model'
import CreatorHistory from '../creators/creatorHistory.model'
import { CurationResult } from './application.model'

interface CurationOutcome {
  result: CurationResult
  reason: string
  /** true kalau ini auto-reject (compliance gate) — Application.status langsung 'rejected', bukan cuma advisory */
  autoRejected: boolean
}

/**
 * Seleksi Creator Otomatis (AD-20). Rekomendasi/filtering awal saja — keputusan
 * akhir tetap admin (Tab 4 no.5), KECUALI compliance gate (SP1/SP2) yang memang
 * auto-reject sesuai spesifikasi checklist.
 */
export async function runSmartCuration(
  campaign: ICampaign,
  creator: ICreator,
  tenantId: string | Types.ObjectId
): Promise<CurationOutcome> {
  // 1. Compliance gate — auto-reject, bukan advisory
  if (creator.complianceStatus === 'sp2_blacklist') {
    return { result: 'rejected', reason: 'Creator diblacklist (SP2) — 3× cancel job setelah accepted.', autoRejected: true }
  }
  if (creator.complianceStatus === 'sp1' && creator.sp1Until && creator.sp1Until > new Date()) {
    const until = creator.sp1Until.toLocaleDateString('id-ID')
    return { result: 'rejected', reason: `Creator dalam masa suspend SP1 sampai ${until} (cancel job setelah accepted).`, autoRejected: true }
  }

  // 2. Cek kriteria campaign (soft — advisory, bukan auto-reject)
  const reasons: string[] = []
  let unmetCount = 0

  const { criteria } = campaign
  if (criteria.minFollowers) {
    const maxFollowers = Math.max(0, ...creator.socials.map((s) => s.followers))
    if (maxFollowers < criteria.minFollowers) {
      unmetCount++
      reasons.push(`Followers tertinggi creator (${maxFollowers.toLocaleString('id-ID')}) di bawah minimum campaign (${criteria.minFollowers.toLocaleString('id-ID')}).`)
    }
  }

  if (criteria.niches.length > 0) {
    const hasNicheMatch = creator.niches.some((n) => criteria.niches.includes(n))
    if (!hasNicheMatch) {
      unmetCount++
      reasons.push(`Niche creator (${creator.niches.join(', ') || '-'}) tidak cocok dengan kriteria campaign (${criteria.niches.join(', ')}).`)
    }
  }

  if (criteria.provinces.length > 0) {
    const province = creator.domicile?.province
    if (!province || !criteria.provinces.includes(province)) {
      unmetCount++
      reasons.push(`Domisili creator (${province || 'belum diisi'}) di luar target campaign (${criteria.provinces.join(', ')}).`)
    }
  }

  if (criteria.platforms.length > 0) {
    const hasPlatform = creator.socials.some((s) => criteria.platforms.includes(s.platform))
    if (!hasPlatform) {
      unmetCount++
      reasons.push(`Creator tidak punya akun di platform target (${criteria.platforms.join(', ')}).`)
    }
  }

  // 3. Brand experience — sinyal positif kalau pernah kerja sama dengan brand ini
  const brandExperienceCount = await CreatorHistory.countDocuments({
    tenantId,
    creatorId: creator._id,
    brandId: campaign.brandId,
  })

  if (unmetCount > 0) {
    return { result: 'need_review', reason: reasons.join(' '), autoRejected: false }
  }

  const score = creator.performanceScore.overall
  if (score >= 85 && brandExperienceCount > 0) {
    return {
      result: 'highly_recommended',
      reason: `Semua kriteria terpenuhi, performance score ${score}, pernah kerja sama dengan brand ini ${brandExperienceCount}× sebelumnya.`,
      autoRejected: false,
    }
  }
  if (score >= 70 || brandExperienceCount > 0) {
    return {
      result: 'recommended',
      reason: `Semua kriteria terpenuhi, performance score ${score}${brandExperienceCount > 0 ? `, pernah kerja sama dengan brand ini ${brandExperienceCount}×` : ''}.`,
      autoRejected: false,
    }
  }
  return {
    result: 'need_review',
    reason: `Semua kriteria terpenuhi tapi performance score masih rendah (${score}) atau belum ada histori — perlu ditinjau manual.`,
    autoRejected: false,
  }
}
