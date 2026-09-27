import { Router, Request, Response, NextFunction } from 'express'
import { connectDB } from '../db/connect'
import Portfolio, { IPortfolio } from '../models/Portfolio'

const router = Router()

const PUBLISHED = { status: { $ne: 'draft' } }

// CPV & metrik tambahan per platform hanya keluar ke publik kalau admin mengizinkan
function toPublic(doc: IPortfolio) {
  const p = doc.toJSON() as Record<string, any>
  if (!p.cpvPublic) delete p.cpv
  p.platforms = (p.platforms || []).map((r: Record<string, any>) => {
    if (r.showExtraPublic) return r
    const { reach, impressions, engagement, er, ...rest } = r
    return rest
  })
  return p
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    await connectDB()
    const items = await Portfolio.find(PUBLISHED).sort({ createdAt: -1 })
    res.json(items.map(toPublic))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.get('/featured', async (_req: Request, res: Response) => {
  try {
    await connectDB()
    const items = await Portfolio.find({ ...PUBLISHED, featured: true }).limit(3).sort({ createdAt: -1 })
    res.json(items.map(toPublic))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  // regex, bukan isValidObjectId: string 12 karakter spt 'case-studies' dianggap ObjectId valid
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return next()
  try {
    await connectDB()
    const item = await Portfolio.findOne({ _id: req.params.id, ...PUBLISHED })
    if (!item) { res.status(404).json({ message: 'Not found' }); return }
    res.json(toPublic(item))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
