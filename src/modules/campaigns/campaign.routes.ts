import { Router, Response } from 'express'
import crypto from 'crypto'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { env } from '../../config/env'
import { generateText } from '../../lib/ai'
import Campaign, { WORKFLOW_STAGES, WorkflowStage } from './campaign.model'
import { computeCampaignAnalytics, getCampaignCreatorSummaries } from './analytics.service'
import { generateCampaignInsight } from './insight.service'
import { buildReportHtml } from '../documents/reportTemplate'
import { generateCaseStudy } from '../documents/caseStudy.service'
import { renderHtmlToPdf } from '../../lib/pdf'
import { uploadToCloudinary } from '../../lib/cloudinary'
import Brand from '../../models/Brand'
import DocumentModel from '../documents/document.model'
import Application from '../applications/application.model'
import Creator from '../creators/creator.model'
import { enqueueWaMessage } from '../../lib/baileys'
import { getTemplate, renderTemplate } from '../whatsapp/template.service'
import { transitionWorkflow, tryAutoTransition, getCreatorSubStages, WorkflowTransitionError, WORKFLOW_TRANSITIONS } from './workflow.service'
import WorkflowAudit from './workflowAudit.model'

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

// workflowStage SENGAJA tidak di sini — harus lewat POST /:id/workflow/transition
// (AD-32) supaya tervalidasi & tercatat di WorkflowAudit, bukan di-patch bebas.
const EDITABLE_FIELDS = [
  'name', 'objective', 'deliverables', 'budget', 'timeline', 'criteria',
  'type', 'eventDetails', 'picUserId', 'handleByUserId', 'fee',
  'briefContent', 'waGroupLink', 'targetKpi', 'status', 'applyOpen',
] as const

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const updates: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (field in req.body) updates[field] = req.body[field]
    }
    const before = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!before) { res.status(404).json({ message: 'Not found' }); return }
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId },
      updates,
      { new: true }
    )
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }

    // AD-31: campaign_started / campaign_completed — kirim ke client saat status berubah
    if (updates.status && updates.status !== before.status && ['active', 'completed'].includes(updates.status as string)) {
      const trigger = updates.status === 'active' ? 'campaign_started' : 'campaign_completed'
      const brand = await Brand.findById(campaign.brandId)
      if (brand?.whatsapp) {
        const template = await getTemplate(req.auth!.tenantId, trigger)
        const payload = renderTemplate(template, { bill_to: brand.namaBrand, campaign: campaign.name })
        await enqueueWaMessage({ tenantId: req.auth!.tenantId, trigger, to: brand.whatsapp, payload, campaignId: String(campaign._id) })
      }
    }

    // AD-32: auto-transition tahap 2->3 / 3->4 saat toggle buka/tutup pendaftaran
    if (typeof updates.applyOpen === 'boolean' && updates.applyOpen !== before.applyOpen) {
      if (updates.applyOpen) {
        await tryAutoTransition({ campaignId: campaign.id, tenantId: req.auth!.tenantId, fromStage: 'listing', toStage: 'open_registration', userId: req.auth!.userId })
      } else {
        await tryAutoTransition({ campaignId: campaign.id, tenantId: req.auth!.tenantId, fromStage: 'open_registration', toStage: 'internal_review', userId: req.auth!.userId })
      }
    }

    res.json(campaign)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-30: kirim brief campaign ke semua creator yang sudah diterima (trigger #3, terpisah dari notifikasi diterima)
router.post('/:id/send-brief', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }
    if (!campaign.briefContent) { res.status(400).json({ message: 'Brief belum dibuat' }); return }

    const applications = await Application.find({ tenantId: req.auth!.tenantId, campaignId: campaign._id, status: 'accepted' }).populate('creatorId')
    const template = await getTemplate(req.auth!.tenantId, 'brief_campaign')
    let sent = 0
    for (const app of applications) {
      const creator = app.creatorId as unknown as { name: string; phone: string } | null
      if (!creator?.phone) continue
      const payload = renderTemplate(template, { nama: creator.name, campaign: campaign.name, brief: campaign.briefContent })
      await enqueueWaMessage({ tenantId: req.auth!.tenantId, trigger: 'brief_campaign', to: creator.phone, payload, campaignId: String(campaign._id) })
      sent++
    }

    // AD-32: brief terkirim -> auto maju ke brief_sent lalu waiting_draft
    for (const from of ['creator_approved', 'client_approval'] as const) {
      await tryAutoTransition({ campaignId: campaign.id, tenantId: req.auth!.tenantId, fromStage: from, toStage: 'brief_sent', userId: req.auth!.userId })
    }
    await tryAutoTransition({ campaignId: campaign.id, tenantId: req.auth!.tenantId, fromStage: 'brief_sent', toStage: 'waiting_draft', userId: req.auth!.userId })

    res.json({ sent })
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim brief', error: (err as Error).message })
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

    // AD-32: report ter-generate -> auto maju ke report_generated
    await tryAutoTransition({ campaignId: campaign.id, tenantId: req.auth!.tenantId, fromStage: 'insight_collected', toStage: 'report_generated', userId: req.auth!.userId })

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

interface BroadcastBody {
  title: string
  urgent?: boolean
  location?: string
  schedule?: string
  fee: string
  topPayment: string
  syarat: string
  sow: string
  note?: string
  pic: string
  recipients: string[] | 'all_creators'
}

// AD-31: Broadcast Campaign — kirim ke daftar nomor manual atau semua creator approved
router.post('/:id/broadcast', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }

    const body = req.body as BroadcastBody
    if (!body.title || !body.fee || !body.syarat) {
      res.status(400).json({ message: 'title, fee, dan syarat wajib diisi' })
      return
    }

    let numbers: string[]
    if (body.recipients === 'all_creators') {
      const creators = await Creator.find({ tenantId: req.auth!.tenantId, status: 'approved' }, 'phone')
      numbers = creators.map((c) => c.phone).filter(Boolean)
    } else {
      numbers = (body.recipients || []).filter(Boolean)
    }
    if (!numbers.length) { res.status(400).json({ message: 'Tidak ada penerima' }); return }

    const template = await getTemplate(req.auth!.tenantId, 'broadcast_campaign')
    const payload = renderTemplate(template, {
      urgent_label: body.urgent ? '🚨 URGENT — ' : '',
      title: body.title,
      location_schedule: body.location || body.schedule ? `📍 ${body.location || '-'}\n🗓️ ${body.schedule || '-'}\n\n` : '',
      fee: body.fee,
      top_payment: body.topPayment,
      syarat: body.syarat,
      sow: body.sow,
      note: body.note ? `📝 Catatan: ${body.note}\n` : '',
      apply_link: `${env.clientOrigin}/apply/${campaign.applySlug}`,
      pic: body.pic,
    })

    let sent = 0
    for (const to of numbers) {
      await enqueueWaMessage({ tenantId: req.auth!.tenantId, trigger: 'broadcast_campaign', to, payload, campaignId: String(campaign._id) })
      sent++
    }
    res.status(201).json({ sent })
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim broadcast', error: (err as Error).message })
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

// AD-32: state 17-tahap campaign + sub-tahap per creator (dihitung, bukan disimpan) + histori transisi
router.get('/:id/workflow', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }
    const creatorStages = await getCreatorSubStages(req.params.id, req.auth!.tenantId)
    const history = await WorkflowAudit.find({ tenantId: req.auth!.tenantId, campaignId: req.params.id }).sort({ createdAt: -1 }).populate('byUserId', 'name')
    res.json({
      workflowStage: campaign.workflowStage,
      validNextStages: WORKFLOW_TRANSITIONS[campaign.workflowStage],
      creatorStages,
      history,
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-32: transisi tahap tervalidasi (guard transisi + role) — owner/admin-dengan-alasan bisa override
router.post('/:id/workflow/transition', async (req: AuthRequest, res: Response) => {
  try {
    const { toStage, reason, override } = req.body as { toStage?: WorkflowStage; reason?: string; override?: boolean }
    if (!toStage || !WORKFLOW_STAGES.includes(toStage)) {
      res.status(400).json({ message: 'toStage wajib diisi dan valid' })
      return
    }
    await connectDB()
    const campaign = await transitionWorkflow({
      campaignId: req.params.id,
      tenantId: req.auth!.tenantId,
      toStage,
      userId: req.auth!.userId,
      role: req.auth!.role as 'owner' | 'admin' | 'ce' | 'finance',
      reason,
      override,
    })
    res.json(campaign)
  } catch (err) {
    if (err instanceof WorkflowTransitionError) {
      res.status(400).json({ message: err.message })
      return
    }
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
