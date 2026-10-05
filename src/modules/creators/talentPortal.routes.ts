import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Application from '../applications/application.model'
import Creator from './creator.model'
import { ensurePortalToken } from '../campaigns/progress.service'

const router = Router()
router.use(requireAuth, requireRole('creator'))

router.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const creator = await Creator.findOne({ tenantId: req.auth!.tenantId, _id: req.auth!.userId })
    if (!creator) { res.status(404).json({ message: 'Not found' }); return }
    res.json({ name: creator.name, phone: creator.phone, email: creator.email || '' })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Lengkapi email untuk creator yang sign up sebelum field ini ditambahkan (AD-49 follow-up).
router.patch('/me', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { email } = req.body
    if (!email) { res.status(400).json({ message: 'Email wajib diisi' }); return }
    const creator = await Creator.findOne({ tenantId: req.auth!.tenantId, _id: req.auth!.userId })
    if (!creator) { res.status(404).json({ message: 'Not found' }); return }
    creator.email = email
    await creator.save()
    res.json({ name: creator.name, phone: creator.phone, email: creator.email })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-22: campaign aktif milik creator
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
    // Update progress sekarang lewat tabel portal (magic link), bukan form upload — login lama
    // cukup jadi pintu masuk ke link tsb.
    const items = await Promise.all(applications.map(async (a) => ({
      applicationId: a._id, campaign: a.campaignId, portalToken: await ensurePortalToken(a),
    })))
    res.json(items)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
