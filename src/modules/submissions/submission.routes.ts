import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { parseInsightScreenshot } from '../../lib/ai'
import Submission from './submission.model'
import Campaign from '../campaigns/campaign.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce'))

router.get('/campaigns/:campaignId/submissions', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return }
    const submissions = await Submission.find({ tenantId: req.auth!.tenantId, campaignId: campaign._id })
      .populate('creatorId', 'name phone')
      .sort({ createdAt: -1 })
    res.json(submissions)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/**
 * AD-23: baca semua screenshot submission ini lewat AI vision, gabung jadi satu
 * parsedInsight — beberapa screenshot untuk 1 post biasanya panel insight yang
 * berbeda (views di 1 gambar, likes/comments di gambar lain), jadi digabung
 * per-field (ambil nilai pertama yang tidak null), bukan ditimpa/dirata-rata.
 * Hasil ini BELUM verified — admin masih perlu cek/koreksi manual (AI bisa salah baca).
 */
router.post('/submissions/:id/parse-insight', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const submission = await Submission.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!submission) { res.status(404).json({ message: 'Not found' }); return }
    if (submission.insightScreenshotUrls.length === 0) {
      res.status(400).json({ message: 'Submission ini belum ada screenshot insight' })
      return
    }

    const results = await Promise.all(
      submission.insightScreenshotUrls.map((url) => parseInsightScreenshot(url, submission.platform))
    )

    const merged: Record<string, number | undefined> = {}
    for (const field of ['views', 'reach', 'likes', 'comments', 'shares', 'saves'] as const) {
      for (const r of results) {
        if (r[field] !== undefined && r[field] !== null) {
          merged[field] = r[field]
          break
        }
      }
    }

    submission.parsedInsight = { ...merged, verifiedByUserId: undefined, verifiedAt: undefined }
    await submission.save()
    res.json(submission)
  } catch (err) {
    res.status(500).json({ message: 'Gagal membaca insight', error: (err as Error).message })
  }
})

const EDITABLE_INSIGHT_FIELDS = ['views', 'reach', 'likes', 'comments', 'shares', 'saves'] as const

// Admin koreksi manual + tandai terverifikasi
router.patch('/submissions/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const submission = await Submission.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!submission) { res.status(404).json({ message: 'Not found' }); return }

    if (req.body.status) submission.status = req.body.status
    if (req.body.revisionNotes !== undefined) submission.revisionNotes = req.body.revisionNotes

    if (req.body.parsedInsight) {
      const current = submission.parsedInsight || {}
      for (const field of EDITABLE_INSIGHT_FIELDS) {
        if (field in req.body.parsedInsight) current[field] = req.body.parsedInsight[field]
      }
      current.verifiedByUserId = req.auth!.userId as never
      current.verifiedAt = new Date()
      submission.parsedInsight = current
    }

    await submission.save()
    res.json(submission)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
