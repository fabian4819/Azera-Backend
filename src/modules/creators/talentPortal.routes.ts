import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { upload } from '../../middleware/upload'
import { uploadToCloudinary } from '../../lib/cloudinary'
import Application from '../applications/application.model'
import Submission from '../submissions/submission.model'

const router = Router()
router.use(requireAuth, requireRole('creator'))

// AD-22: campaign aktif milik creator (fungsi dasar saja — checklist tab 1 no.5)
router.get('/campaigns', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const applications = await Application.find({
      tenantId: req.auth!.tenantId,
      creatorId: req.auth!.userId,
      status: 'accepted',
    })
      .populate('campaignId')
      .sort({ createdAt: -1 })
    res.json(applications.map((a) => ({ applicationId: a._id, campaign: a.campaignId })))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.get('/campaigns/:campaignId', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const application = await Application.findOne({
      tenantId: req.auth!.tenantId,
      creatorId: req.auth!.userId,
      campaignId: req.params.campaignId,
      status: 'accepted',
    }).populate('campaignId')
    if (!application) { res.status(404).json({ message: 'Not found' }); return }
    const submissions = await Submission.find({
      tenantId: req.auth!.tenantId,
      creatorId: req.auth!.userId,
      campaignId: req.params.campaignId,
    }).sort({ createdAt: -1 })
    res.json({ campaign: application.campaignId, submissions })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-22: upload link post + screenshot insight (Cloudinary)
router.post(
  '/campaigns/:campaignId/submissions',
  upload.array('insightScreenshots', 6),
  async (req: AuthRequest, res: Response) => {
    try {
      await connectDB()
      const application = await Application.findOne({
        tenantId: req.auth!.tenantId,
        creatorId: req.auth!.userId,
        campaignId: req.params.campaignId,
        status: 'accepted',
      })
      if (!application) { res.status(404).json({ message: 'Kamu tidak terdaftar di campaign ini' }); return }

      const { type, platform, link } = req.body
      if (!type || !platform) {
        res.status(400).json({ message: 'type dan platform wajib diisi' })
        return
      }

      const files = (req.files as Express.Multer.File[]) || []
      const insightScreenshotUrls = await Promise.all(
        files.map((f) => uploadToCloudinary(f.buffer, `submissions/${req.params.campaignId}`))
      )

      const submission = await Submission.create({
        tenantId: req.auth!.tenantId,
        campaignId: req.params.campaignId,
        creatorId: req.auth!.userId,
        type, platform, link,
        insightScreenshotUrls,
      })

      res.status(201).json(submission)
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: (err as Error).message })
    }
  }
)

export default router
