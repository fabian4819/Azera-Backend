import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Creator from './creator.model'
import CreatorHistory from './creatorHistory.model'
import SocialSnapshot from '../extension/socialSnapshot.model'
import { computePerformanceScore } from './performanceScore.service'
import { syncCreatorToSheet } from '../../lib/sheetSync.service'
import { getTabUrl } from '../../lib/googleSheets'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce'))

// Metrik headline (bukan semua field snapshot) — cukup buat kolom tabel Creators bisa
// di-sort/filter per platform tanpa bikin payload list membengkak dengan raw sampleRows dll.
const HEADLINE_METRIC_FIELDS = ['followers', 'engagementRate', 'avgViews', 'avgLikes'] as const
type HeadlineMetrics = Partial<Record<(typeof HEADLINE_METRIC_FIELDS)[number], number>>

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { status, complianceStatus, niche } = req.query
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId }
    if (status) filter.status = status
    if (complianceStatus) filter.complianceStatus = complianceStatus
    if (niche) filter.niches = { $in: [niche] }
    const creators = await Creator.find(filter).sort({ 'performanceScore.overall': -1 })

    // Snapshot terbaru per (creator, platform) — satu query buat semua creator di halaman ini,
    // dikelompokkan di memori (jauh lebih murah daripada N query per creator).
    const snapshots = await SocialSnapshot.find(
      { tenantId: req.auth!.tenantId, creatorId: { $in: creators.map((c) => c._id) } },
      { creatorId: 1, platform: 1, ...Object.fromEntries(HEADLINE_METRIC_FIELDS.map((f) => [f, 1])), createdAt: 1 }
    ).sort({ createdAt: -1 })
    const latestByCreatorPlatform = new Map<string, HeadlineMetrics>()
    for (const snap of snapshots) {
      const key = `${snap.creatorId}:${snap.platform}`
      if (!latestByCreatorPlatform.has(key)) {
        latestByCreatorPlatform.set(
          key,
          Object.fromEntries(HEADLINE_METRIC_FIELDS.map((f) => [f, snap[f]])) as HeadlineMetrics
        )
      }
    }

    const withMetrics = creators.map((c) => {
      const extensionMetrics: Record<string, HeadlineMetrics> = {}
      for (const social of c.socials || []) {
        const m = latestByCreatorPlatform.get(`${c._id}:${social.platform}`)
        if (m) extensionMetrics[social.platform] = m
      }
      return { ...c.toJSON(), extensionMetrics }
    })

    res.json(withMetrics)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Link tombol "Buka Sheet" di halaman list Creators — semua creator ada di satu tab "Creators"
// di master spreadsheet (bukan per-creator), jadi ini bukan route :id. Ditaruh sebelum GET /:id
// biar 'sheet-url' tidak ketangkep sebagai :id.
router.get('/sheet-url', async (_req: AuthRequest, res: Response) => {
  res.json({ url: await getTabUrl('Creators') })
})

// AD-21: profil creator + breakdown skor transparan (syarat klien: bisa diklik lihat sumbernya)
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const creator = await Creator.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!creator) { res.status(404).json({ message: 'Not found' }); return }
    const scoreBreakdown = await computePerformanceScore(creator._id, req.auth!.tenantId)
    const history = await CreatorHistory.find({ tenantId: req.auth!.tenantId, creatorId: creator._id })
      .populate('brandId', 'namaBrand')
      .populate('campaignId', 'name')
      .sort({ createdAt: -1 })
    const snapshots = await SocialSnapshot.find({ tenantId: req.auth!.tenantId, creatorId: creator._id })
      .sort({ createdAt: 1 })
    res.json({ creator, scoreBreakdown, history, snapshots })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

const EDITABLE_FIELDS = [
  'gender', 'birthDate', 'domicile', 'socials', 'activities', 'niches', 'nicheOther',
  'contentStyles', 'contentStyleOther', 'bankAccount', 'npwp', 'mediaKitUrl',
  'portfolioLink', 'photoUrl', 'status',
] as const

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const updates: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (field in req.body) updates[field] = req.body[field]
    }
    const creator = await Creator.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId },
      updates,
      { new: true }
    )
    if (!creator) { res.status(404).json({ message: 'Not found' }); return }
    syncCreatorToSheet(creator).catch((err) => console.error('Sheet sync error (creator):', err))
    res.json(creator)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

const SP1_DURATION_DAYS = 90

/**
 * AD-21 Penalty & Compliance: record-only, sistem TIDAK hitung denda — cukup
 * catat histori. Suspension tetap otomatis: cancel setelah accepted -> SP1 (90
 * hari); 3x cancel -> blacklist (SP2). Trigger recompute performance score.
 */
router.post('/:id/history', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const creator = await Creator.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!creator) { res.status(404).json({ message: 'Not found' }); return }

    const { campaignId, brandId, uploadedOnTime, revisions, responseTimeHours, violation } = req.body
    if (!campaignId || !brandId) {
      res.status(400).json({ message: 'campaignId dan brandId wajib diisi' })
      return
    }

    await CreatorHistory.create({
      tenantId: req.auth!.tenantId,
      creatorId: creator._id,
      campaignId, brandId,
      uploadedOnTime: uploadedOnTime ?? true,
      revisions: revisions ?? 0,
      responseTimeHours,
      violation,
    })

    if (violation === 'cancelled_after_accepted') {
      creator.cancelCount += 1
      if (creator.cancelCount >= 3) {
        creator.complianceStatus = 'sp2_blacklist'
        creator.sp1Until = undefined
      } else {
        creator.complianceStatus = 'sp1'
        creator.sp1Until = new Date(Date.now() + SP1_DURATION_DAYS * 24 * 60 * 60 * 1000)
      }
      await creator.save()
      syncCreatorToSheet(creator).catch((err) => console.error('Sheet sync error (creator):', err))
    }

    const scoreBreakdown = await computePerformanceScore(creator._id, req.auth!.tenantId)
    res.status(201).json({ creator, scoreBreakdown })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Unlock manual dari admin (checklist: "jika pengen perbaiki, hubungi admin buat unlock")
router.post('/:id/unlock', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const creator = await Creator.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId },
      { complianceStatus: 'ok', sp1Until: undefined },
      { new: true }
    )
    if (!creator) { res.status(404).json({ message: 'Not found' }); return }
    syncCreatorToSheet(creator).catch((err) => console.error('Sheet sync error (creator):', err))
    res.json(creator)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
