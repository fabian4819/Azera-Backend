import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import LeadBotTemplate from './leadBotTemplate.model'
import { LEAD_BOT_TRIGGERS } from './leadBotTemplate.model'
import { ensureAllLeadBotTemplates } from './leadBotTemplate.service'
import { LEAD_BOT_DEFAULTS } from './leadBotDefaultTemplates'
import { LOCKED_BRAND_REFERENCE } from './leadBot.service'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

/**
 * Template pesan bot lead-intake (Brand/KOL/Support di WhatsApp, lihat leadBot.service.ts).
 * `lockedReference` dikirim apa adanya (bukan dari DB) — label field template Brand & daftar
 * pilihan Jasa/Budget TIDAK adjustable, karena parser bot mencocokkannya secara harfiah.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const templates = await ensureAllLeadBotTemplates()
    const withMeta = templates.map((t) => ({
      trigger: t.trigger,
      body: t.body,
      label: LEAD_BOT_DEFAULTS[t.trigger].label,
      description: LEAD_BOT_DEFAULTS[t.trigger].description,
      placeholders: LEAD_BOT_DEFAULTS[t.trigger].placeholders || [],
    }))
    res.json({ templates: withMeta, lockedReference: LOCKED_BRAND_REFERENCE })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.patch('/:trigger', async (req: AuthRequest, res: Response) => {
  try {
    const { trigger } = req.params
    if (!LEAD_BOT_TRIGGERS.includes(trigger as (typeof LEAD_BOT_TRIGGERS)[number])) {
      res.status(400).json({ message: 'Trigger tidak dikenal' })
      return
    }
    const { body } = req.body as { body?: string }
    if (!body) { res.status(400).json({ message: 'body wajib diisi' }); return }
    await connectDB()
    const tpl = await LeadBotTemplate.findOneAndUpdate({ trigger }, { body }, { new: true, upsert: true })
    res.json(tpl)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
