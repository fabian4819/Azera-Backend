import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Creator, { SocialPlatform } from '../creators/creator.model'
import Submission from '../submissions/submission.model'
import ExtensionToken, { generateRawToken, hashToken } from './extensionToken.model'
import SocialSnapshot from './socialSnapshot.model'
import CaptureIntent from './captureIntent.model'
import { LINKABLE_PLATFORMS, normalizeHandle } from './extension.service'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce'))

const PROFILE_URL: Record<SocialPlatform, (h: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}/`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  threads: (h) => `https://www.threads.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
}

/* ---------------- Kode sambungan ---------------- */

router.get('/tokens', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tokens = await ExtensionToken.find({ tenantId: req.auth!.tenantId })
      .populate('createdByUserId', 'name')
      .sort({ createdAt: -1 })
    res.json(tokens.map((t) => ({
      _id: t._id,
      label: t.label,
      hint: t.hint,
      createdBy: t.createdByUserId,
      lastUsedAt: t.lastUsedAt,
      revokedAt: t.revokedAt,
      createdAt: t.createdAt,
    })))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.post('/tokens', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const label = (req.body.label || '').trim() || 'Ekstensi tanpa nama'
    const { raw, hint } = generateRawToken()
    const token = await ExtensionToken.create({
      tenantId: req.auth!.tenantId,
      createdByUserId: req.auth!.userId,
      label,
      hint,
      tokenHash: hashToken(raw),
    })
    // plaintext hanya di response ini, tidak pernah lagi
    res.status(201).json({ _id: token._id, label, hint, code: raw })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.delete('/tokens/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const token = await ExtensionToken.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId },
      { revokedAt: new Date() },
      { new: true }
    )
    if (!token) { res.status(404).json({ message: 'Not found' }); return }
    res.json({ ok: true })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/* ---------------- KOL Radar (snapshots) ---------------- */

// daftar: satu baris per handle, snapshot terbaru + delta followers vs snapshot sebelumnya
router.get('/snapshots', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { platform, linked, search } = req.query
    const match: Record<string, unknown> = { tenantId: req.auth!.tenantId }
    if (platform && LINKABLE_PLATFORMS.includes(platform as SocialPlatform)) match.platform = platform
    if (linked === 'true') match.creatorId = { $ne: null }
    if (linked === 'false') match.creatorId = null
    if (search) match.username = { $regex: normalizeHandle(String(search)), $options: 'i' }

    const rows = await SocialSnapshot.find(match).sort({ createdAt: -1 }).limit(1000).populate('creatorId', 'name')

    const byHandle = new Map<string, typeof rows>()
    for (const r of rows) {
      const key = `${r.platform}:${r.username}`
      if (!byHandle.has(key)) byHandle.set(key, [] as never)
      byHandle.get(key)!.push(r)
    }

    const list = [...byHandle.values()].map((snaps) => {
      const latest = snaps[0]
      const prev = snaps[1]
      const oldest = snaps[snaps.length - 1]
      return {
        platform: latest.platform,
        username: latest.username,
        profileUrl: latest.profileUrl,
        displayName: latest.displayName,
        avatarUrl: latest.avatarUrl,
        bio: latest.bio,
        isVerified: latest.isVerified,
        creator: latest.creatorId,
        latestSnapshotId: latest._id,

        followers: latest.followers,
        following: latest.following,
        postsCount: latest.postsCount,
        avgLikes: latest.avgLikes,
        avgComments: latest.avgComments,
        avgViews: latest.avgViews,
        avgShares: latest.avgShares,
        medLikes: latest.medLikes,
        medComments: latest.medComments,
        medViews: latest.medViews,
        engagementRate: latest.engagementRate,
        engagementRateMedian: latest.engagementRateMedian,
        engagementRateViews: latest.engagementRateViews,
        erBasis: latest.erBasis,
        postsSampled: latest.postsSampled,
        totalCollected: latest.totalCollected,
        paidPosts: latest.paidPosts,
        organicPosts: latest.organicPosts,
        postsPerWeek: latest.postsPerWeek,
        postRangeDays: latest.postRangeDays,
        outlierRatio: latest.outlierRatio,
        roundedNumbers: latest.roundedNumbers,
        sampleRows: latest.sampleRows || [],

        followersDelta: latest.followers != null && prev?.followers != null ? latest.followers - prev.followers : null,
        followersDeltaAll:
          latest.followers != null && oldest?.followers != null && snaps.length > 1
            ? latest.followers - oldest.followers
            : null,
        firstCapturedAt: oldest.createdAt,
        snapshotCount: snaps.length,
        missingFields: latest.missingFields,
        niche: latest.niche,
        notes: latest.notes,
        shortlistCampaign: latest.shortlistCampaign,
        capturedAt: latest.createdAt,
        // deret followers untuk sparkline (lama -> baru)
        followerSeries: [...snaps].reverse().map((s) => ({ t: s.createdAt, v: s.followers ?? null })),
      }
    }).sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt))

    res.json(list)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// riwayat lengkap satu handle — buat grafik pertumbuhan di CreatorDetail / radar
router.get('/snapshots/history', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { platform, username, creatorId } = req.query
    const match: Record<string, unknown> = { tenantId: req.auth!.tenantId }
    if (creatorId) match.creatorId = creatorId
    if (platform) match.platform = platform
    if (username) match.username = normalizeHandle(String(username))
    if (!match.creatorId && !match.username) {
      res.status(400).json({ message: 'butuh creatorId atau username' })
      return
    }
    const snaps = await SocialSnapshot.find(match).sort({ createdAt: 1 })
    res.json(snaps)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// hapus semua snapshot satu handle dari radar (kepencet, salah akun, prospek basi)
router.delete('/snapshots', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { platform, username } = req.query
    if (!platform || !username) {
      res.status(400).json({ message: 'platform & username wajib' })
      return
    }
    const r = await SocialSnapshot.deleteMany({
      tenantId: req.auth!.tenantId,
      platform: String(platform),
      username: normalizeHandle(String(username)),
    })
    res.json({ ok: true, deleted: r.deletedCount })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// link snapshot prospek ke creator existing, atau buat creator baru dari snapshot
router.post('/snapshots/:id/link', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const snap = await SocialSnapshot.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!snap) { res.status(404).json({ message: 'Snapshot tidak ditemukan' }); return }

    if (!LINKABLE_PLATFORMS.includes(snap.platform as SocialPlatform)) {
      res.status(400).json({ message: `Platform ${snap.platform} tidak bisa ditautkan ke Creator (cuma IG/TikTok/Threads/X)` })
      return
    }
    const snapPlatform = snap.platform as SocialPlatform

    let creator: InstanceType<typeof Creator> | null = null
    if (req.body.creatorId) {
      creator = await Creator.findOne({ _id: req.body.creatorId, tenantId: req.auth!.tenantId })
      if (!creator) { res.status(404).json({ message: 'Creator tidak ditemukan' }); return }
      const exists = creator.socials.some(
        (s) => s.platform === snap.platform && s.username.toLowerCase() === snap.username
      )
      if (!exists) {
        creator.socials.push({
          platform: snapPlatform,
          username: snap.username,
          profileUrl: snap.profileUrl,
          followers: snap.followers || 0,
        })
        await creator.save()
      }
    } else if (req.body.createCreator) {
      const { name, phone } = req.body.createCreator
      if (!name || !phone) { res.status(400).json({ message: 'name & phone wajib untuk creator baru' }); return }
      const dup = await Creator.findOne({ tenantId: req.auth!.tenantId, phone })
      if (dup) { res.status(409).json({ message: 'Nomor HP sudah terdaftar' }); return }
      creator = await Creator.create({
        tenantId: req.auth!.tenantId,
        name, phone,
        socials: [{
          platform: snapPlatform, username: snap.username,
          profileUrl: snap.profileUrl, followers: snap.followers || 0,
        }],
        niches: req.body.createCreator.niches || [],
        source: 'import',
        status: 'reviewing',
      })
    } else {
      res.status(400).json({ message: 'butuh creatorId atau createCreator' })
      return
    }

    // backfill: semua snapshot handle ini di-link ke creator tsb
    await SocialSnapshot.updateMany(
      { tenantId: req.auth!.tenantId, platform: snapPlatform, username: snap.username },
      { creatorId: creator._id }
    )

    res.json({ ok: true, creator: { _id: creator._id, name: creator.name } })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/* ---------------- Capture intent (redirect dari web) ---------------- */

router.post('/capture-intents', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { type, creatorId, submissionId } = req.body
    if (type !== 'profile' && type !== 'post') {
      res.status(400).json({ message: 'type harus profile atau post' })
      return
    }

    let platform: SocialPlatform
    let handle: string | undefined
    let targetUrl: string
    let label: string
    let campaignId: string | undefined

    if (type === 'profile') {
      const creator = await Creator.findOne({ _id: creatorId, tenantId: req.auth!.tenantId })
      if (!creator) { res.status(404).json({ message: 'Creator tidak ditemukan' }); return }
      platform = req.body.platform
      const acct = creator.socials.find((s) => s.platform === platform)
      if (!LINKABLE_PLATFORMS.includes(platform) || !acct) {
        res.status(400).json({ message: 'Creator belum punya akun di platform itu' })
        return
      }
      handle = normalizeHandle(acct.username)
      targetUrl = acct.profileUrl || PROFILE_URL[platform](handle)
      label = `Tarik metrik profil ${creator.name} (@${handle})`
    } else {
      const sub = await Submission.findOne({ _id: submissionId, tenantId: req.auth!.tenantId }).populate('creatorId', 'name')
      if (!sub) { res.status(404).json({ message: 'Submission tidak ditemukan' }); return }
      if (!sub.link) { res.status(400).json({ message: 'Submission belum ada link post' }); return }
      platform = sub.platform
      targetUrl = sub.link
      campaignId = String(sub.campaignId)
      const cName = (sub.creatorId as unknown as { name?: string })?.name || 'creator'
      label = `Tarik insight post ${cName}`
    }

    const intent = await CaptureIntent.create({
      tenantId: req.auth!.tenantId,
      createdByUserId: req.auth!.userId,
      type, platform, handle, targetUrl,
      creatorId: type === 'profile' ? creatorId : undefined,
      submissionId: type === 'post' ? submissionId : undefined,
      campaignId,
      label,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })

    const sep = targetUrl.includes('#') ? '' : '#'
    res.status(201).json({
      intentId: intent._id,
      // ekstensi baca hash #azk=<id> di halaman sosmed
      url: `${targetUrl}${sep}azk=${intent._id}`,
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
