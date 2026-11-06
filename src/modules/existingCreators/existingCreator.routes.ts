import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import ExistingCreator from './existingCreator.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

const PAGE_SIZE = 100
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SORTS: Record<string, Record<string, 1 | -1>> = {
  name: { name: 1 }, ig: { 'instagram.followers': -1 }, tiktok: { 'tiktok.followers': -1 }, newest: { createdAt: -1 },
}

// Menu Existing Creator: cari nama/WA/username/domisili, filter niche, urutkan, 100 per halaman
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tenantId = req.auth!.tenantId
    const q = String(req.query.q ?? '').trim()
    const niche = String(req.query.niche ?? '').trim()
    const page = Math.max(1, Number(req.query.page) || 1)
    const filter: Record<string, unknown> = { tenantId }
    if (niche) filter.niches = new RegExp(`^${escape(niche)}$`, 'i')
    if (q) {
      const rx = new RegExp(escape(q), 'i')
      const digits = q.replace(/\D/g, '').replace(/^0/, '62')
      filter.$or = [
        { name: rx }, { domicile: rx }, { 'instagram.username': rx }, { 'tiktok.username': rx }, { approval: rx },
        ...(digits.length >= 4 ? [{ phone: new RegExp(escape(digits)) }] : []),
      ]
    }
    const [items, total, niches] = await Promise.all([
      ExistingCreator.find(filter).sort(SORTS[String(req.query.sort)] ?? SORTS.name).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      ExistingCreator.countDocuments(filter),
      ExistingCreator.distinct('niches', { tenantId }),
    ])
    res.json({ items, total, page, pageSize: PAGE_SIZE, niches: (niches as string[]).sort() })
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: (err as Error).message })
  }
})

export default router
