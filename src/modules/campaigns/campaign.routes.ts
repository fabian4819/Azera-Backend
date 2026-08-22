import { Router, Response } from 'express'
import crypto from 'crypto'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { generateText } from '../../lib/ai'
import Campaign from './campaign.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce'))

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  const suffix = crypto.randomBytes(3).toString('hex')
  return `${base}-${suffix}`
}

function generateAccessCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase()
}

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const {
      brandId, name, objective, deliverables, budget, timeline,
      criteria, type, eventDetails, picUserId, handleByUserId, fee,
    } = req.body
    if (!brandId || !name || !objective || budget === undefined) {
      res.status(400).json({ message: 'brandId, name, objective, budget wajib diisi' })
      return
    }
    const campaign = await Campaign.create({
      tenantId: req.auth!.tenantId,
      brandId, name, objective,
      deliverables: deliverables || [],
      budget, timeline: timeline || {},
      criteria: criteria || { niches: [], provinces: [], platforms: [] },
      type: type || 'online',
      eventDetails,
      picUserId: picUserId || req.auth!.userId,
      handleByUserId,
      fee: fee || {},
      applySlug: slugify(name),
      accessCode: generateAccessCode(),
    })
    res.status(201).json(campaign)
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: (err as Error).message })
  }
})

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { status, brandId } = req.query
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId }
    if (status) filter.status = status
    if (brandId) filter.brandId = brandId
    const campaigns = await Campaign.find(filter).sort({ createdAt: -1 })
    res.json(campaigns)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }
    res.json(campaign)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

const EDITABLE_FIELDS = [
  'name', 'objective', 'deliverables', 'budget', 'timeline', 'criteria',
  'type', 'eventDetails', 'picUserId', 'handleByUserId', 'fee',
  'briefContent', 'workflowStage', 'status', 'applyOpen',
] as const

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const updates: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (field in req.body) updates[field] = req.body[field]
    }
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId },
      updates,
      { new: true }
    )
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }
    res.json(campaign)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/**
 * AD-18: AI compose objective+deliverables jadi brief terstruktur. Admin tetap
 * bisa edit hasilnya lewat PATCH /:id sebelum brief final (catatan checklist).
 */
router.post('/:id/generate-brief', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }

    const prompt = `Susun brief campaign KOL berikut jadi dokumen brief yang rapi dan profesional dalam Bahasa Indonesia.

Nama Campaign: ${campaign.name}
Tujuan (input mentah dari admin): ${campaign.objective}
Deliverables (kalau ada): ${campaign.deliverables.join(', ') || '(belum ditentukan, tolong usulkan)'}
Budget: Rp${campaign.budget.toLocaleString('id-ID')}
Kriteria Creator: niche ${campaign.criteria.niches.join('/') || '-'}, min followers ${campaign.criteria.minFollowers ?? '-'}, domisili ${campaign.criteria.provinces.join('/') || '-'}, platform ${campaign.criteria.platforms.join('/') || '-'}
Timeline: ${campaign.timeline.startDate ?? '-'} s/d ${campaign.timeline.endDate ?? '-'}

Kembalikan HANYA JSON (tanpa markdown code block) dengan struktur:
{"objective": "kalimat objective yang rapi", "deliverables": ["deliverable 1", "deliverable 2"], "briefContent": "isi brief lengkap siap dikirim ke creator, mencakup objective, deliverables, dan kriteria"}`

    const raw = await generateText(prompt, 'Kamu adalah asisten yang menyusun brief campaign influencer marketing untuk agency KOL Indonesia.')
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned) as { objective: string; deliverables: string[]; briefContent: string }

    campaign.objective = parsed.objective || campaign.objective
    if (parsed.deliverables?.length) campaign.deliverables = parsed.deliverables
    campaign.briefContent = parsed.briefContent
    await campaign.save()

    res.json(campaign)
  } catch (err) {
    res.status(500).json({ message: 'Gagal generate brief', error: (err as Error).message })
  }
})

export default router
