import { Types } from 'mongoose'
import Creator, { SocialPlatform } from '../creators/creator.model'
import Submission from '../submissions/submission.model'
import SocialSnapshot, { ISocialSnapshot, SnapshotPlatform, SNAPSHOT_PLATFORMS } from './socialSnapshot.model'

/** platform yang bisa ditautkan ke Creator.socials */
export const LINKABLE_PLATFORMS: SocialPlatform[] = ['instagram', 'tiktok', 'threads', 'x']
export { SNAPSHOT_PLATFORMS }

/**
 * Handle sosmed jadi bentuk kanonik untuk dicocokkan:
 *  "@Handle" / "handle/" / " handle " / "https://instagram.com/handle/?hl=id"
 *  / "tiktok.com/@handle"  ->  "handle"
 */
export function normalizeHandle(input: string): string {
  let s = String(input || '').trim()
  if (/\//.test(s)) {
    // ambil segmen path terakhir yang tidak kosong (buang host + query)
    s = s.split(/[?#]/)[0].replace(/\/+$/, '')
    const seg = s.split('/').filter(Boolean)
    s = seg[seg.length - 1] || ''
  }
  return s.replace(/^@/, '').toLowerCase()
}

/** samakan link post: buang query, trailing slash, host bervariasi (vt.tiktok, m.) */
export function normalizePostUrl(input: string): string {
  try {
    const u = new URL(String(input).trim())
    let host = u.hostname.replace(/^(www\.|m\.|mobile\.)/, '')
    if (host === 'twitter.com') host = 'x.com'
    return `${host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return String(input || '').trim().toLowerCase().replace(/\/+$/, '')
  }
}

/**
 * Baris akun dari panel ekstensi (`snapshotRow` di panel.js). Nama field-nya
 * snake_case dan sebagian beda dari model — dipetakan di `ingestSnapshot`.
 */
export interface SampleRowInput {
  post?: string | null
  url?: string
  tanggal?: string
  ts_perkiraan?: boolean
  format?: string
  judul?: string
  likes?: number | null
  comments?: number | null
  views?: number | null
  shares?: number | null
  saves?: number | null
  berbayar?: boolean
}

export interface AkunInput {
  platform: string
  username: string
  name?: string
  avatar?: string
  bio?: string
  verified?: string
  url?: string
  followers?: number | null
  following?: number | null
  post_count?: number | null

  avg_likes?: number | null
  avg_comments?: number | null
  avg_views?: number | null
  avg_shares?: number | null
  med_likes?: number | null
  med_comments?: number | null
  med_views?: number | null

  er_percent?: number | null
  er_median_percent?: number | null
  er_views_percent?: number | null
  er_basis?: string

  sample_posts?: number | null
  total_collected?: number | null
  post_berbayar?: number | null
  post_organik?: number | null
  per_minggu?: number | null
  rentang_hari?: number | null
  outlier_ratio?: number | null
  angka_dibulatkan?: string
  sample_rows?: SampleRowInput[]

  category?: string
  notes?: string
  diambil?: string
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}
function numOrNull(v: unknown): number | null {
  return num(v) ?? null
}

/**
 * Simpan snapshot + coba cocokkan ke Creator lewat socials.username (case-insensitive).
 * Kalau ketemu: update `followers` di social account itu (data manual milik staf
 * — kategori/rate/kontak — TIDAK disentuh, sama seperti aturan KOL Lister).
 */
export async function ingestSnapshot(
  tenantId: string,
  userId: string,
  akun: AkunInput,
  opts: { captureIntentId?: string; forceCreatorId?: string; shortlistCampaign?: string } = {}
): Promise<{
  snapshot: ISocialSnapshot
  matchedCreator: { _id: string; name: string } | null
  isNewProspect: boolean
  isFirstSnapshot: boolean
}> {
  const platform = String(akun.platform || '').toLowerCase() as SnapshotPlatform
  if (!SNAPSHOT_PLATFORMS.includes(platform)) throw new Error(`Platform "${akun.platform}" belum didukung`)
  const username = normalizeHandle(akun.username)
  if (!username) throw new Error('username kosong')

  const followers = num(akun.followers)
  const engagementRate =
    akun.er_basis === 'views' ? num(akun.er_views_percent) ?? num(akun.er_percent) : num(akun.er_percent)

  const metrics = {
    followers,
    following: num(akun.following),
    postsCount: num(akun.post_count),

    avgLikes: num(akun.avg_likes),
    avgComments: num(akun.avg_comments),
    avgViews: num(akun.avg_views),
    avgShares: num(akun.avg_shares),
    medLikes: num(akun.med_likes),
    medComments: num(akun.med_comments),
    medViews: num(akun.med_views),

    engagementRate,
    engagementRateMedian: num(akun.er_median_percent),
    engagementRateViews: num(akun.er_views_percent),
    erBasis: akun.er_basis || undefined,

    postsSampled: num(akun.sample_posts),
    totalCollected: num(akun.total_collected),
    paidPosts: num(akun.post_berbayar),
    organicPosts: num(akun.post_organik),
    postsPerWeek: num(akun.per_minggu),
    postRangeDays: num(akun.rentang_hari),
    outlierRatio: num(akun.outlier_ratio),
    roundedNumbers: akun.angka_dibulatkan === 'ya' ? true : undefined,
  }
  // yang benar-benar "belum kebaca" cuma angka inti — sisanya turunan sampel
  const CORE = ['followers', 'following', 'postsCount', 'avgLikes', 'avgComments', 'engagementRate'] as const
  const missing = CORE.filter((k) => metrics[k] === undefined)

  const sampleRows = Array.isArray(akun.sample_rows)
    ? akun.sample_rows.slice(0, 30).map((r) => ({
        post: r.post || undefined,
        url: r.url || undefined,
        date: r.tanggal || undefined,
        approxDate: !!r.ts_perkiraan,
        format: r.format || undefined,
        title: r.judul || undefined,
        likes: numOrNull(r.likes),
        comments: numOrNull(r.comments),
        views: numOrNull(r.views),
        shares: numOrNull(r.shares),
        saves: numOrNull(r.saves),
        paid: !!r.berbayar,
      }))
    : undefined

  const canLink = LINKABLE_PLATFORMS.includes(platform as SocialPlatform)
  let creator: InstanceType<typeof Creator> | null = null
  if (opts.forceCreatorId) {
    creator = await Creator.findOne({ _id: opts.forceCreatorId, tenantId })
  } else if (canLink) {
    // Pencocokan: username akun sosial (platform + handle). Dinormalkan di kedua
    // sisi — stored bisa "@Handle", "handle/", "instagram.com/handle", spasi —
    // jadi perbandingannya di JS, bukan regex query.
    const kandidat = await Creator.find({ tenantId, 'socials.platform': platform }).select('name socials')
    creator =
      kandidat.find((c) =>
        c.socials.some((s) => s.platform === platform && normalizeHandle(s.username) === username)
      ) || null
  }

  const priorCount = await SocialSnapshot.countDocuments({ tenantId, platform, username })

  const snapshot = await SocialSnapshot.create({
    tenantId,
    platform,
    username,
    profileUrl: akun.url || undefined,
    displayName: akun.name || undefined,
    avatarUrl: akun.avatar || undefined,
    bio: akun.bio?.trim() || undefined,
    isVerified: akun.verified === 'ya' ? true : undefined,
    ...metrics,
    sampleRows,
    missingFields: missing,
    niche: akun.category?.trim() || undefined,
    notes: akun.notes?.trim() || undefined,
    shortlistCampaign: opts.shortlistCampaign?.trim() || undefined,
    raw: {
      er_basis: akun.er_basis,
      er_percent: akun.er_percent,
      er_views_percent: akun.er_views_percent,
      post_berbayar: akun.post_berbayar,
      angka_dibulatkan: akun.angka_dibulatkan,
      diambil: akun.diambil,
    },
    creatorId: creator?._id,
    capturedByUserId: userId,
    captureIntentId: opts.captureIntentId ? new Types.ObjectId(opts.captureIntentId) : undefined,
  })

  if (creator && typeof followers === 'number' && followers > 0) {
    const acct = creator.socials.find(
      (s) => s.platform === platform && s.username.toLowerCase() === username
    )
    if (acct) {
      acct.followers = followers
      if (akun.url && !acct.profileUrl) acct.profileUrl = akun.url
      await creator.save()
    }
  }

  return {
    snapshot,
    matchedCreator: creator ? { _id: String(creator._id), name: creator.name } : null,
    isNewProspect: !creator,
    isFirstSnapshot: priorCount === 0,
  }
}

/** cari submission yang link post-nya cocok, dalam tenant ini */
export async function findSubmissionsByPostUrl(tenantId: string, postUrl: string) {
  const target = normalizePostUrl(postUrl)
  const subs = await Submission.find({ tenantId, link: { $exists: true, $ne: '' } })
    .populate('creatorId', 'name')
    .populate('campaignId', 'name')
    .sort({ createdAt: -1 })
    .limit(300)
  return subs.filter((s) => s.link && normalizePostUrl(s.link) === target)
}
