import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import Brand from '../../models/Brand'
import { requireAuth, requireRole, effectiveRole, AuthRequest } from '../../middleware/auth'

const router = Router()
router.use(requireAuth)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { status, kategori, search } = req.query
    const filter: Record<string, unknown> = {}
    if (status) filter.status = status
    if (kategori) filter.kategori = kategori
    if (search) filter.namaBrand = { $regex: search, $options: 'i' }
    // Menu Brands (data pengaju) khusus owner; role lain cuma butuh nama brand untuk dropdown buat campaign
    const owner = effectiveRole(req.auth!.role) === 'owner'
    const brands = await Brand.find(filter).select(owner ? {} : { namaBrand: 1 }).sort({ createdAt: -1 })
    res.json(brands)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.get('/:id', requireRole('owner'), async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const brand = await Brand.findById(req.params.id)
    if (!brand) { res.status(404).json({ message: 'Not found' }); return }
    res.json(brand)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.patch('/:id', requireRole('owner'), async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { status, notes } = req.body
    const brand = await Brand.findByIdAndUpdate(
      req.params.id,
      { status, notes },
      { new: true }
    )
    if (!brand) { res.status(404).json({ message: 'Not found' }); return }
    res.json(brand)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

export default router
