import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import KOL from '../../models/KOL'
import { requireAuth, AuthRequest } from '../../middleware/auth'
import { buildKOLApprovalWALink, buildKOLRejectionWALink } from '../../utils/whatsapp'

const router = Router()
router.use(requireAuth)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { status, niche, platform } = req.query
    const filter: Record<string, unknown> = {}
    if (status) filter.status = status
    if (niche) filter.niche = { $in: [niche] }
    if (platform === 'instagram') filter['instagram.username'] = { $exists: true }
    if (platform === 'tiktok') filter['tiktok.username'] = { $exists: true }
    if (platform === 'youtube') filter['youtube.channel'] = { $exists: true }
    const kols = await KOL.find(filter).sort({ createdAt: -1 })
    res.json(kols)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const kol = await KOL.findById(req.params.id)
    if (!kol) { res.status(404).json({ message: 'Not found' }); return }
    res.json(kol)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { status, catatanKurasi, alasanReject } = req.body
    const kol = await KOL.findByIdAndUpdate(
      req.params.id,
      { status, catatanKurasi, alasanReject },
      { new: true }
    )
    if (!kol) { res.status(404).json({ message: 'Not found' }); return }
    res.json(kol)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.get('/:id/wa-link', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const kol = await KOL.findById(req.params.id)
    if (!kol) { res.status(404).json({ message: 'Not found' }); return }
    const type = req.query.type as string
    const link = type === 'reject'
      ? buildKOLRejectionWALink({ whatsapp: kol.whatsapp, namaLengkap: kol.namaLengkap, alasan: kol.alasanReject })
      : buildKOLApprovalWALink({ whatsapp: kol.whatsapp, namaLengkap: kol.namaLengkap })
    res.json({ link })
  } catch { res.status(500).json({ message: 'Server error' }) }
})

export default router
