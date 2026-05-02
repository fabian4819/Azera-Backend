import { Router, Response } from 'express'
import { connectDB } from '../../lib/db'
import Brand from '../../models/Brand'
import { requireAuth, AuthRequest } from '../../middleware/auth'

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
    const brands = await Brand.find(filter).sort({ createdAt: -1 })
    res.json(brands)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const brand = await Brand.findById(req.params.id)
    if (!brand) { res.status(404).json({ message: 'Not found' }); return }
    res.json(brand)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.patch('/:id', async (req: AuthRequest, res: Response) => {
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
