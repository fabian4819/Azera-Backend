import { Router, Response } from 'express'
import crypto from 'crypto'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { generateText } from '../../lib/ai'
import Campaign from './campaign.model'
import { computeCampaignAnalytics, getCampaignCreatorSummaries } from './analytics.service'
import { generateCampaignInsight } from './insight.service'
import { buildReportHtml } from '../documents/reportTemplate'
import { generateCaseStudy } from '../documents/caseStudy.service'
import { renderHtmlToPdf } from '../../lib/pdf'
import { uploadToCloudinary } from '../../lib/cloudinary'
import Brand from '../../models/Brand'
import DocumentModel from '../documents/document.model'

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
      criteria, type, eventDetails, picUserId, handleByUserId, fee, targetKpi,
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
      targetKpi: targetKpi || {},
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
    const campaigns = await Campaign.find(filter).populate('brandId', 'namaBrand').sort({ createdAt: -1 })
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
  'briefContent', 'targetKpi', 'workflowStage', 'status', 'applyOpen',
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

// AD-23: agregasi insight per campaign (views/reach/ER/CPM, pencapaian target KPI)
router.get('/:id/analytics', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }
    const analytics = await computeCampaignAnalytics(campaign._id, req.auth!.tenantId)
    res.json(analytics)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-24: AI Campaign Insight — analisis pencapaian target, platform terbaik, creator paling efisien
router.post('/:id/generate-insight', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const insight = await generateCampaignInsight(req.params.id, req.auth!.tenantId)
    res.json({ aiInsight: insight })
  } catch (err) {
    res.status(500).json({ message: 'Gagal generate insight', error: (err as Error).message })
  }
})

// AD-26: Auto Report Generator — HTML->PDF via Puppeteer, ganti trigger WA "Final Report Ready" yang di-drop
router.post('/:id/generate-report', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }
    const brand = await Brand.findById(campaign.brandId)
    const analytics = await computeCampaignAnalytics(campaign._id, req.auth!.tenantId)
    const creators = await getCampaignCreatorSummaries(campaign._id, req.auth!.tenantId)

    const html = buildReportHtml({ campaign, brandName: brand?.namaBrand || 'Brand', analytics, creators })
    const pdfBuffer = await renderHtmlToPdf(html)
    const pdfUrl = await uploadToCloudinary(pdfBuffer, `reports/${campaign._id}`)

    const document = await DocumentModel.create({
      tenantId: req.auth!.tenantId,
      type: 'report',
      campaignId: campaign._id,
      brandId: campaign.brandId,
      data: { analytics, creators, aiInsight: campaign.aiInsight },
      pdfUrl,
    })

    res.status(201).json(document)
  } catch (err) {
    res.status(500).json({ message: 'Gagal generate report', error: (err as Error).message })
  }
})

// AD-27: Auto Case Study Generator (model content website — model IG di-drop)
router.post('/:id/generate-case-study', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const document = await generateCaseStudy(req.params.id, req.auth!.tenantId)
    res.status(201).json(document)
  } catch (err) {
    res.status(500).json({ message: 'Gagal generate case study', error: (err as Error).message })
  }
})

// Dokumen (report/case study/invoice) yang sudah dibuat untuk campaign ini
router.get('/:id/documents', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const documents = await DocumentModel.find({ tenantId: req.auth!.tenantId, campaignId: req.params.id }).sort({ createdAt: -1 })
    res.json(documents)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
