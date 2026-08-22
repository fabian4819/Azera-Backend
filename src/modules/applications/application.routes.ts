import { Router, Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Application from './application.model'
import Creator from '../creators/creator.model'
import Campaign from '../campaigns/campaign.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce'))

// AD-19/20: daftar pendaftar per campaign, buat keputusan akhir admin
// Mounted di /api/admin/applications -> path lengkap /api/admin/applications/campaign/:campaignId
router.get('/campaign/:campaignId', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return }
    const applications = await Application.find({ tenantId: req.auth!.tenantId, campaignId: campaign._id })
      .populate('creatorId')
      .sort({ createdAt: -1 })
    res.json(applications)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/**
 * AD-20: keputusan akhir admin (rekomendasi sistem cuma advisory). Saat status
 * jadi 'accepted', kalau creator belum punya password Talent Portal, generate
 * sekarang — ini momen "creator diterima" yang nanti jadi trigger WA (modul 4)
 * berisi kredensial login. Password plaintext dikembalikan SEKALI di response.
 */
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { status } = req.body as { status: 'accepted' | 'rejected' }
    if (!['accepted', 'rejected'].includes(status)) {
      res.status(400).json({ message: 'status harus accepted atau rejected' })
      return
    }
    const application = await Application.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId },
      { status, decidedByUserId: req.auth!.userId, decidedAt: new Date() },
      { new: true }
    )
    if (!application) { res.status(404).json({ message: 'Not found' }); return }

    let generatedPassword: string | undefined
    if (status === 'accepted') {
      const creator = await Creator.findOne({ _id: application.creatorId, tenantId: req.auth!.tenantId })
      if (creator && !creator.password) {
        generatedPassword = crypto.randomBytes(4).toString('hex')
        creator.password = await bcrypt.hash(generatedPassword, 12)
        await creator.save()
      }
    }

    res.json({ application, generatedPassword })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
