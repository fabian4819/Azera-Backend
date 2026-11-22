import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Portfolio from '../../models/Portfolio'
import TopCreator from './topCreator.model'

/** Menu Top Creator: top 3 creator semua campaign. Sumber: portfolio (otomatis, diedit di menu Portfolio)
 * + entri manual untuk campaign yang belum punya portfolio. */
const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce'))

/** Format metrik di portfolio diketik bebas: "18000", "199.442", "6.4K", "1,2 jt" → angka. Tanpa satuan,
 * titik/koma dianggap pemisah ribuan. */
export function metric(v: unknown): number | undefined {
  const m = String(v ?? '').trim().toLowerCase().match(/^([\d.,]+)\s*(k|rb|ribu|m|jt|juta)?$/)
  if (!m) return undefined
  if (!m[2]) return Number(m[1].replace(/[.,]/g, ''))
  const mult = ['k', 'rb', 'ribu'].includes(m[2]) ? 1e3 : 1e6
  return Math.round(parseFloat(m[1].replace(',', '.')) * mult)
}

const FIELDS = ['campaign', 'brand', 'period', 'name', 'username', 'phone', 'platform', 'postLink'] as const
const METRICS = ['views', 'likes', 'comments', 'shares'] as const

function clean(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const f of FIELDS) if (typeof body[f] === 'string') out[f] = (body[f] as string).trim().slice(0, 300)
  for (const f of METRICS) if (f in body) out[f] = metric(body[f])
  if (typeof out.postLink === 'string' && out.postLink && !/^https?:\/\/\S+$/i.test(out.postLink as string)) delete out.postLink
  return out
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const [manual, portfolios] = await Promise.all([
      TopCreator.find({ tenantId: req.auth!.tenantId }).sort({ createdAt: -1 }),
      Portfolio.find({}).select('title brand period topCreators status').sort({ createdAt: -1 }),
    ])
    const fromPortfolio = portfolios.flatMap((p) => (p.topCreators || []).map((c, i) => ({
      id: `p:${p._id}:${i}`, source: 'portfolio' as const, portfolioId: String(p._id),
      campaign: p.title, brand: p.brand || '', period: p.period || '', name: c.name, username: '', phone: '',
      platform: c.platform, postLink: c.postLink || '',
      views: metric(c.views), likes: metric(c.likes), comments: metric(c.comments), shares: metric(c.shares),
    })))
    res.json([
      ...manual.map((m) => ({ id: String(m._id), source: 'manual' as const, ...clean(m.toObject() as unknown as Record<string, unknown>), views: m.views, likes: m.likes, comments: m.comments, shares: m.shares })),
      ...fromPortfolio,
    ])
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const data = clean(req.body)
    if (!data.campaign || !data.name) { res.status(400).json({ message: 'Nama campaign & nama creator wajib diisi' }); return }
    const doc = await TopCreator.create({ ...data, tenantId: req.auth!.tenantId })
    res.status(201).json(doc)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const doc = await TopCreator.findOneAndUpdate({ _id: req.params.id, tenantId: req.auth!.tenantId }, clean(req.body), { new: true })
    if (!doc) { res.status(404).json({ message: 'Not found' }); return }
    res.json(doc)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    await TopCreator.deleteOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
