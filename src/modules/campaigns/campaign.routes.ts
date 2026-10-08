import { Router, Response } from 'express'
import crypto from 'crypto'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { env } from '../../config/env'
import { generateText } from '../../lib/ai'
import Campaign, { WORKFLOW_STAGES, WorkflowStage, IProgressColumn, PROGRESS_TYPES, SUBMISSION_FIELDS } from './campaign.model'
import { upload } from '../../middleware/upload'
import { writeProgressCell, appendScreenshots, CellError, ensurePortalToken, portalUrl } from './progress.service'
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
import PicUser from '../pic/pic.model'
import WaContact from '../whatsapp/waContact.model'
import { enqueueWaMessage } from '../../lib/baileys'
import { getTemplate, renderTemplate } from '../whatsapp/template.service'
import { transitionWorkflow, tryAutoTransition, getCreatorSubStages, WorkflowTransitionError, WORKFLOW_TRANSITIONS } from './workflow.service'
import WorkflowAudit from './workflowAudit.model'
import { buildSheetView, SHEET_KINDS, SheetKind } from './sheetView.service'
import { getCampaignTabUrl } from '../../lib/googleSheets'

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
      feeNote, benefits, requirements, infoLink, customFields, applyFields,
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
      feeNote, benefits: benefits || [], requirements: requirements || [], infoLink,
      customFields: customFields || [],
      ...(applyFields ? { applyFields: sanitizeApplyFields(applyFields) } : {}),
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

// Dashboard "Semua Campaign" admin. Sheet-nya dibuka di halaman /campaigns/:id/sheet (link Google
// Sheets ada di sana), jadi di sini tidak perlu panggil API Sheets per load.
// Harus didefinisikan sebelum /:id supaya "dashboard-links" tidak dianggap sebagai Mongo ID.
router.get('/dashboard-links', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaigns = await Campaign.find({ tenantId: req.auth!.tenantId })
      .populate('brandId', 'namaBrand')
      .sort({ createdAt: -1 })
    res.json(campaigns)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Grup WA (WaContact @g.us) milik bot partnership — share broadcast listing dikirim lewat WA partnership.
router.get('/wa-groups', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const groups = await WaContact.find({ tenantId: req.auth!.tenantId, bot: 'partnership', jid: /@g\.us$/ }, 'jid name').sort({ lastMessageAt: -1 })
    res.json(groups)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }
    // 3 link sheet — cuma di sini (route admin), BUKAN di dashboard.service.ts, karena itu juga
    // dipakai jalur akses-kode publik (publicCampaign.routes.ts) yang tidak boleh bocorin link
    // ke spreadsheet internal. masterSheetUrl per-campaign (tab-nya beda tiap campaign); report
    // & recap payment statis (1 sheet dipakai bareng semua campaign).
    const masterSheetUrl = await getCampaignTabUrl(campaign.name)
    res.json({
      ...campaign.toJSON(),
      masterSheetUrl,
      reportSheetUrl: env.googleSheetsReportUrl || null,
      recapPaymentSheetUrl: env.googleSheetsRecapPaymentUrl || null,
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Tabel ala spreadsheet (Master / Report / Recap Payment) untuk halaman Sheet admin —
// data dari DB (sheetView.service.ts), sheetUrl cuma buat tombol "Buka di Google Sheets".
router.get('/:id/sheet/:kind', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const kind = req.params.kind as SheetKind
    if (!SHEET_KINDS.includes(kind)) { res.status(400).json({ message: 'Sheet tidak dikenal' }); return }
    const view = await buildSheetView(req.auth!.tenantId, req.params.id, kind)
    if (!view) { res.status(404).json({ message: 'Not found' }); return }
    const sheetUrl = kind === 'master'
      ? await getCampaignTabUrl(view.campaign.name)
      : (kind === 'report' ? env.googleSheetsReportUrl : env.googleSheetsRecapPaymentUrl) || null
    res.json({ ...view, sheetUrl })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Edit sel kolom progress dari Master Sheet admin — logic sama dengan portal creator (progress.service.ts)
async function loadCellTarget(req: AuthRequest) {
  const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
  const application = campaign && await Application.findOne({ _id: req.body.applicationId, campaignId: campaign._id, tenantId: req.auth!.tenantId })
  if (!campaign || !application) throw new CellError('Baris tidak ditemukan', 404)
  return { tenantId: req.auth!.tenantId, campaign, application, columnId: String(req.body.columnId), actor: 'admin' as const, userId: req.auth!.userId }
}

function sendCellError(res: Response, err: unknown) {
  if (err instanceof CellError) res.status(err.status).json({ message: err.message })
  else {
    console.error('Sheet cell error:', err)
    res.status(500).json({ message: 'Server error' })
  }
}

router.patch('/:id/sheet/cell', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    await writeProgressCell(await loadCellTarget(req), req.body.value)
    res.json({ ok: true })
  } catch (err) {
    sendCellError(res, err)
  }
})

router.post('/:id/sheet/cell/upload', upload.array('files', 6), async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    await appendScreenshots(await loadCellTarget(req), (req.files as Express.Multer.File[]) || [])
    res.json({ ok: true })
  } catch (err) {
    sendCellError(res, err)
  }
})

// workflowStage SENGAJA tidak di sini — harus lewat POST /:id/workflow/transition
// (AD-32) supaya tervalidasi & tercatat di WorkflowAudit, bukan di-patch bebas.
const EDITABLE_FIELDS = [
  'name', 'objective', 'deliverables', 'budget', 'timeline', 'criteria',
  'type', 'eventDetails', 'picUserId', 'handleByUserId', 'fee',
  'briefContent', 'waGroupLink', 'targetKpi', 'status', 'applyOpen',
  'customFields', 'applyFields', 'progressColumns', 'columnAccess',
  'feeNote', 'benefits', 'requirements', 'infoLink',
] as const

function sanitizeApplyFields(a: Record<string, unknown> = {}) {
  return { pic: a.pic !== false, handleBy: a.handleBy !== false, handleByRequired: a.handleByRequired === true }
}

const ACCESS = ['hidden', 'view', 'edit'] as const
const PLATFORMS = ['instagram', 'tiktok', 'threads', 'x'] as const
const has = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T)

/** Kolom progress dari admin dirapikan di sini (bukan cuma andalkan enum schema, yang tidak jalan
 * di findOneAndUpdate) — kolom tanpa label dibuang, binding Submission harus lengkap & valid. */
function sanitizeProgressColumns(input: unknown): IProgressColumn[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((c): IProgressColumn[] => {
    const label = String(c?.label ?? '').trim().slice(0, 80)
    if (!label) return []
    const b = c.submission
    const submission = b && b.type && has(['draft', 'post'] as const, b.type) && has(PLATFORMS, b.platform) && has(SUBMISSION_FIELDS, b.field)
      ? { type: b.type, platform: b.platform, field: b.field }
      : undefined
    return [{
      id: String(c.id || crypto.randomUUID()),
      label,
      type: has(PROGRESS_TYPES, c.type) ? c.type : 'text',
      submission,
      creatorAccess: has(ACCESS, c.creatorAccess) ? c.creatorAccess : 'edit',
    }]
  })
}

function sanitizeColumnAccess(input: unknown): Record<string, 'hidden' | 'view'> {
  const out: Record<string, 'hidden' | 'view'> = {}
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) if (v === 'hidden' || v === 'view') out[k] = v
  }
  return out
}

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const updates: Record<string, unknown> = {}
    for (const field of EDITABLE_FIELDS) {
      if (field in req.body) updates[field] = req.body[field]
    }
    if ('progressColumns' in updates) updates.progressColumns = sanitizeProgressColumns(updates.progressColumns)
    if ('columnAccess' in updates) updates.columnAccess = sanitizeColumnAccess(updates.columnAccess)
    if ('applyFields' in updates) updates.applyFields = sanitizeApplyFields((updates.applyFields || {}) as Record<string, unknown>)
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
      const payload = renderTemplate(template, {
        nama: creator.name, campaign: campaign.name, brief: campaign.briefContent, portal_link: portalUrl(await ensurePortalToken(app)),
      })
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
 * AD-18: AI susun Broadcast Campaign (pesan WA format Azera) dari data campaign.
 * Disimpan di briefContent; admin tetap bisa edit lewat PATCH /:id sebelum kirim.
 */
const BROADCAST_EXAMPLE = `*SMARTFREN RUN BANDUNG | AZERA* 🏃🏻‍♂️

*Info event:*
https://www.instagram.com/p/xxxx/

*Fee talent:*
* Option 1 (9 Oktober): Rp140.000
* Option 2 (11 Oktober): Rp100.000 + 🎫 FREE Ticket Smartfren Run senilai Rp150.000
_fee pic 10k, mg 10k_

*Kriteria*
- Usia 18-30 tahun
- All gender
- Tiktok & Instagram minimal followers 100 (wajib akun aktif)

*OPSI Lokasi & Tanggal*
> bisa pilih di form
1️⃣ *Option 1*
📣 9 Oktober 2026 — Woro-woro
📍 Braga, Bandung
⏰ Standby pukul 15.00 WIB (stay 2-3 jam)

*SOW:*
- 1x Visit sesuai opsi yang dipilih
- 1x Instagram Reels Mirroring Tiktok Video

*Daftar:*
https://link-daftar

PIC: AZERA
Handle by + WA:`

router.post('/:id/generate-brief', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }
    const brandName = (await Brand.findById(campaign.brandId).select('namaBrand'))?.namaBrand ?? '-'
    const applyUrl = typeof req.body?.applyUrl === 'string' ? req.body.applyUrl : '-'

    const prompt = `Buat pesan WhatsApp "Broadcast Campaign" untuk merekrut creator/talent, PERSIS mengikuti gaya & struktur contoh di bawah (format WA: *bold*, _italic_, > quote, emoji secukupnya).

CONTOH FORMAT:
${BROADCAST_EXAMPLE}

DATA CAMPAIGN:
Nama Campaign: ${campaign.name}
Brand: ${brandName}
Tujuan / detail dari admin: ${campaign.objective}
Deliverables/SOW: ${campaign.deliverables.join(', ') || '(belum ditentukan)'}
Kriteria Creator: niche ${campaign.criteria.niches.join('/') || '-'}, min followers ${campaign.criteria.minFollowers ?? '-'}, domisili ${campaign.criteria.provinces.join('/') || '-'}, platform ${campaign.criteria.platforms.join('/') || '-'}
Timeline: ${campaign.timeline.startDate ?? '-'} s/d ${campaign.timeline.endDate ?? '-'}
Link daftar: ${applyUrl}

Aturan:
- Judul: *NAMA CAMPAIGN | AZERA* + emoji yang relevan.
- Bagian yang datanya tidak ada (mis. fee, lokasi, info event) tetap tulis judulnya dengan isian "..." supaya admin lengkapi, JANGAN mengarang angka fee/tanggal/lokasi.
- Akhiri dengan "PIC:" dan "Handle by + WA:" dibiarkan kosong.
- Kembalikan HANYA teks pesannya, tanpa code block atau penjelasan.`

    const raw = await generateText(prompt, 'Kamu adalah admin agency KOL Indonesia (Azera) yang menulis broadcast lowongan campaign untuk grup WhatsApp talent.')
    campaign.briefContent = raw.replace(/^```\w*\s*/, '').replace(/```\s*$/, '').trim()
    await campaign.save()

    res.json(campaign)
  } catch (err) {
    res.status(500).json({ message: 'Gagal generate broadcast', error: (err as Error).message })
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

// Share teks broadcast apa adanya (sudah diedit admin) ke grup WA & creator terpilih.
// Selalu lewat WA partnership; `bot` eksplisit = kiriman manual admin, tidak ikut toggle automation broadcast_campaign.
router.post('/:id/share', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tenantId = req.auth!.tenantId
    const { message, groupJids = [], creatorIds = [] } = req.body as { message?: string; groupJids?: string[]; creatorIds?: string[] }
    if (!message?.trim()) { res.status(400).json({ message: 'Teks broadcast kosong' }); return }
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId })
    if (!campaign) { res.status(404).json({ message: 'Not found' }); return }

    const groups = groupJids.length ? await WaContact.find({ tenantId, bot: 'partnership', jid: { $in: groupJids.filter((j) => j.endsWith('@g.us')) } }, 'jid') : []
    const creators = creatorIds.length ? await Creator.find({ tenantId, _id: { $in: creatorIds } }, 'phone') : []
    const base = { tenantId, trigger: 'broadcast_campaign' as const, payload: message, campaignId: String(campaign._id), bot: 'partnership' as const }
    let sent = 0
    const failed: string[] = []
    for (const g of groups) {
      await enqueueWaMessage({ ...base, to: g.jid })
      sent++
    }
    for (const c of creators) {
      try {
        await enqueueWaMessage({ ...base, to: c.phone, creatorId: String(c._id) })
        sent++
      } catch {
        failed.push(String(c._id))
      }
    }
    res.status(201).json({ sent, failed })
  } catch (err) {
    res.status(500).json({ message: 'Gagal share broadcast', error: (err as Error).message })
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

// PIC/Handle-by akun (PicUser) yang di-assign admin ke campaign ini — muncul di
// dashboard PIC begitu ditambahkan. Akun PIC sign up sendiri tanpa accessCode,
// jadi satu-satunya cara campaign muncul di dashboard mereka adalah lewat sini.
router.get('/:id/pic', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const picUsers = await PicUser.find({ tenantId: req.auth!.tenantId, campaignIds: req.params.id })
      .select('name email phone')
    res.json(picUsers)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.post('/:id/pic', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { email } = req.body
    if (!email) {
      res.status(400).json({ message: 'Email wajib diisi' })
      return
    }
    const campaign = await Campaign.findOne({ tenantId: req.auth!.tenantId, _id: req.params.id })
    if (!campaign) {
      res.status(404).json({ message: 'Campaign tidak ditemukan' })
      return
    }
    const picUser = await PicUser.findOne({ tenantId: req.auth!.tenantId, email })
    if (!picUser) {
      res.status(404).json({ message: 'PIC dengan email ini belum sign up di /login' })
      return
    }
    const alreadyLinked = picUser.campaignIds.some((cid) => String(cid) === String(campaign._id))
    if (!alreadyLinked) {
      picUser.campaignIds.push(campaign._id)
      await picUser.save()
    }
    res.status(201).json({ _id: picUser._id, name: picUser.name, email: picUser.email, phone: picUser.phone })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.delete('/:id/pic/:picUserId', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const picUser = await PicUser.findOne({ tenantId: req.auth!.tenantId, _id: req.params.picUserId })
    if (!picUser) {
      res.status(404).json({ message: 'PIC tidak ditemukan' })
      return
    }
    picUser.campaignIds = picUser.campaignIds.filter((cid) => String(cid) !== req.params.id)
    await picUser.save()
    res.json({ message: 'PIC dilepas dari campaign ini' })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
