import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Creator from './creator.model'
import CreatorHistory from './creatorHistory.model'
import { computePerformanceScore } from './performanceScore.service'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce'))

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { status, complianceStatus, niche } = req.query
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId }
    if (status) filter.status = status
    if (complianceStatus) filter.complianceStatus = complianceStatus
    if (niche) filter.niches = { $in: [niche] }
    const creators = await Creator.find(filter).sort({ 'performanceScore.overall': -1 })
    res.json(creators)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
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
    res.json({ creator, scoreBreakdown, history })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

const EDITABLE_FIELDS = [
  'gender', 'domicile', 'socials', 'activities', 'niches', 'nicheOther',
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
    res.json(creator)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
