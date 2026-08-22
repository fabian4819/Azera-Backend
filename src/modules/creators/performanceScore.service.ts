import { Types } from 'mongoose'
import CreatorHistory from './creatorHistory.model'
import Creator from './creator.model'

/**
 * 4 sub-skor Performance Score (ACC klien 16 Agu 2026, Review PDF hal. 14).
 * Bobot default: Reliability 40% · Quality 25% · Performance 20% · Communication 15%.
 * Kalau Communication null (belum ada data respons), bobotnya didistribusi
 * proporsional ke 3 sub-skor lainnya — bukan diperlakukan sebagai 0.
 *
 * Setiap sub-skor mengembalikan breakdown mentah (bukan cuma angka akhir) supaya
 * bisa "diklik untuk lihat sumber perhitungan" (syarat transparansi dari klien).
 */

const WEIGHTS = { reliability: 0.4, quality: 0.25, performance: 0.2, communication: 0.15 }

export interface ScoreBreakdown {
  reliability: { score: number; totalCampaigns: number; onTimeCount: number; violationCount: number }
  quality: { score: number; totalCampaigns: number; avgRevisions: number; noRevisionCount: number }
  performance: { score: number; note: string }
  communication: { score: number | null; avgResponseHours: number | null; sampleCount: number }
  overall: number
}

export async function computePerformanceScore(
  creatorId: string | Types.ObjectId,
  tenantId: string | Types.ObjectId
): Promise<ScoreBreakdown> {
  const history = await CreatorHistory.find({ tenantId, creatorId })
  const total = history.length

  // Reliability: % on-time, dipotong tegas untuk cancel/no-show (masalah utama klien)
  const onTimeCount = history.filter((h) => h.uploadedOnTime).length
  const violationCount = history.filter(
    (h) => h.violation === 'cancelled_after_accepted' || h.violation === 'no_show'
  ).length
  const reliabilityScore =
    total === 0 ? 70 : Math.max(0, Math.min(100, (onTimeCount / total) * 100 - violationCount * 15))

  // Quality: makin sedikit revisi & makin banyak yang langsung approved, makin tinggi
  const avgRevisions = total === 0 ? 0 : history.reduce((sum, h) => sum + h.revisions, 0) / total
  const noRevisionCount = history.filter((h) => h.revisions === 0).length
  const qualityScore =
    total === 0 ? 70 : Math.max(0, Math.min(100, (noRevisionCount / total) * 100 - avgRevisions * 10))

  // Performance: % campaign mencapai KPI — BELUM ada sumber data (Campaign Analytics
  // AD-23 di modul 3 belum dibangun). Default netral, transparan soal keterbatasannya.
  const performanceScore = { score: 70, note: 'Belum ada data pencapaian KPI campaign (AD-23, Modul 3) — nilai default netral.' }

  // Communication: rata-rata kecepatan respons, kalau datanya ada
  const withResponseTime = history.filter((h) => h.responseTimeHours !== undefined && h.responseTimeHours !== null)
  let communicationScore: number | null = null
  let avgResponseHours: number | null = null
  if (withResponseTime.length > 0) {
    avgResponseHours = withResponseTime.reduce((sum, h) => sum + (h.responseTimeHours || 0), 0) / withResponseTime.length
    if (avgResponseHours <= 2) communicationScore = 100
    else if (avgResponseHours <= 6) communicationScore = 85
    else if (avgResponseHours <= 24) communicationScore = 70
    else if (avgResponseHours <= 48) communicationScore = 50
    else communicationScore = 30
  }

  // Bobot: redistribusi proporsional kalau communication null
  let weights = { ...WEIGHTS }
  if (communicationScore === null) {
    const remaining = 1 - WEIGHTS.communication
    weights = {
      reliability: WEIGHTS.reliability / remaining,
      quality: WEIGHTS.quality / remaining,
      performance: WEIGHTS.performance / remaining,
      communication: 0,
    }
  }

  const overall = Math.round(
    reliabilityScore * weights.reliability +
      qualityScore * weights.quality +
      performanceScore.score * weights.performance +
      (communicationScore || 0) * weights.communication
  )

  const breakdown: ScoreBreakdown = {
    reliability: { score: Math.round(reliabilityScore), totalCampaigns: total, onTimeCount, violationCount },
    quality: { score: Math.round(qualityScore), totalCampaigns: total, avgRevisions: Math.round(avgRevisions * 10) / 10, noRevisionCount },
    performance: performanceScore,
    communication: { score: communicationScore, avgResponseHours, sampleCount: withResponseTime.length },
    overall,
  }

  await Creator.findByIdAndUpdate(creatorId, {
    performanceScore: {
      reliability: breakdown.reliability.score,
      performance: breakdown.performance.score,
      communication: breakdown.communication.score,
      quality: breakdown.quality.score,
      overall: breakdown.overall,
      updatedAt: new Date(),
    },
  })

  return breakdown
}

export function curationLabel(score: number): 'highly_recommended' | 'recommended' | 'need_review' {
  if (score >= 85) return 'highly_recommended'
  if (score >= 70) return 'recommended'
  return 'need_review'
}
