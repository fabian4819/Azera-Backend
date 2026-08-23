import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import WaTemplate from './waTemplate.model'
import { WA_TRIGGERS } from './waTemplate.model'
import { ensureAllTemplates } from './template.service'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

// AD-30/31: daftar 15 template (auto-seed default kalau belum ada) — admin bisa edit wording
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const templates = await ensureAllTemplates(req.auth!.tenantId)
    res.json(templates)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.patch('/:trigger', async (req: AuthRequest, res: Response) => {
  try {
    const { trigger } = req.params
    if (!WA_TRIGGERS.includes(trigger as (typeof WA_TRIGGERS)[number])) {
      res.status(400).json({ message: 'Trigger tidak dikenal' })
      return
    }
    const { body } = req.body as { body?: string }
    if (!body) { res.status(400).json({ message: 'body wajib diisi' }); return }
    await connectDB()
    const tpl = await WaTemplate.findOneAndUpdate(
      { tenantId: req.auth!.tenantId, trigger },
      { body },
      { new: true, upsert: false }
    )
    if (!tpl) { res.status(404).json({ message: 'Template belum ada, buka daftar dulu (GET /) untuk auto-seed' }); return }
    res.json(tpl)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
