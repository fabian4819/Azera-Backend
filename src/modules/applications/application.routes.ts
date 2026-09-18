import { Router, Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Application from './application.model'
import Creator from '../creators/creator.model'
import Campaign from '../campaigns/campaign.model'
import PicUser from '../pic/pic.model'
import Submission from '../submissions/submission.model'
import { enqueueWaMessage } from '../../lib/baileys'
import { getTemplate, renderTemplate } from '../whatsapp/template.service'
import { WaTrigger } from '../whatsapp/waTemplate.model'
import { tryAutoTransition } from '../campaigns/workflow.service'
import { syncApplicationToSheet } from '../../lib/sheetSync.service'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce'))

// Dipakai di tiap endpoint yang me-return satu application buat REPLACE baris di tabel Pendaftar
// (CampaignDetail.tsx) — kalau latestSubmission gak ikut, kolom submission di baris itu kosong
// sesaat sampai reload (sama kelasnya dengan bug creatorId/picUserId yang kemarin ketemu pas testing).
async function findLatestSubmission(tenantId: unknown, campaignId: unknown, creatorId: unknown) {
  return Submission.findOne({ tenantId, campaignId, creatorId }).sort({ createdAt: -1 })
}

// AD-19/20: daftar pendaftar per campaign, buat keputusan akhir admin
// Mounted di /api/admin/applications -> path lengkap /api/admin/applications/campaign/:campaignId
router.get('/campaign/:campaignId', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return }
    const applications = await Application.find({ tenantId: req.auth!.tenantId, campaignId: campaign._id })
      .populate('creatorId')
      .populate('picUserId', 'name email')
      .sort({ createdAt: -1 })

    // Submission terbaru per creator — sama seperti logika syncCampaignRow (sheetSync.service.ts),
    // supaya tabel Pendaftar di website nunjukin data yang SAMA PERSIS dengan mastersheet campaign
    // (bukan cuma tombol redirect ke Sheet — website tetap jadi display utama, Sheet cuma penunjang).
    const submissions = await Submission.find({ tenantId: req.auth!.tenantId, campaignId: campaign._id }).sort({ createdAt: -1 })
    const latestByCreator = new Map<string, (typeof submissions)[number]>()
    for (const s of submissions) {
      const key = String(s.creatorId)
      if (!latestByCreator.has(key)) latestByCreator.set(key, s)
    }
    const withSubmissions = applications.map((a) => {
      // creatorId sudah di-populate jadi dokumen Creator penuh di atas — _id-nya yang dipakai buat
      // cocokin ke submission map, bukan `a.creatorId` mentah (itu sekarang objek, bukan ObjectId).
      // Optional chaining: creator bisa saja sudah dihapus (referensi yatim) — populate() jadi null,
      // bukan objek, dan akses `._id` langsung bikin 500 di seluruh endpoint (bukan cuma baris ini).
      const creatorId = (a.creatorId as unknown as { _id: unknown } | null)?._id
      return { ...a.toJSON(), latestSubmission: latestByCreator.get(String(creatorId)) || null }
    })

    res.json(withSubmissions)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/**
 * AD-20: keputusan akhir admin (rekomendasi sistem cuma advisory). Saat status
 * jadi 'accepted', kalau creator belum punya password Talent Portal, generate
 * sekarang — ini momen "creator diterima" yang nanti jadi trigger WA (modul 4)
 * berisi kredensial login. Password plaintext dikembalikan SEKALI di response.
 */
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { status } = req.body as { status: 'accepted' | 'rejected' }
    if (!['accepted', 'rejected'].includes(status)) {
      res.status(400).json({ message: 'status harus accepted atau rejected' })
      return
    }
    const application = await Application.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId },
      { status, decidedByUserId: req.auth!.userId, decidedAt: new Date() },
      { new: true }
    ).populate('creatorId').populate('picUserId', 'name email')
    if (!application) { res.status(404).json({ message: 'Not found' }); return }

    let generatedPassword: string | undefined
    if (status === 'accepted') {
      const creator = await Creator.findOne({ _id: application.creatorId, tenantId: req.auth!.tenantId })
      if (creator && !creator.password) {
        generatedPassword = crypto.randomBytes(4).toString('hex')
        creator.password = await bcrypt.hash(generatedPassword, 12)
        await creator.save()
      }
    }

    // AD-30: trigger creator_accepted / creator_rejected
    const creator = application.creatorId as unknown as { _id: string; name: string; phone: string } | null
    const campaign = await Campaign.findOne({ _id: application.campaignId, tenantId: req.auth!.tenantId })
    if (creator?.phone && campaign) {
      const trigger = status === 'accepted' ? 'creator_accepted' : 'creator_rejected'
      const template = await getTemplate(req.auth!.tenantId, trigger)
      const payload = renderTemplate(template, {
        nama: creator.name,
        campaign: campaign.name,
        password: generatedPassword,
        grup_link: campaign.waGroupLink,
      })
      await enqueueWaMessage({ tenantId: req.auth!.tenantId, trigger, to: creator.phone, payload, campaignId: String(campaign._id), creatorId: String(creator._id) })
    }

    // AD-32: creator pertama diterima -> auto maju ke creator_approved
    if (status === 'accepted' && campaign) {
      for (const from of ['internal_review', 'smart_recommendation'] as const) {
        await tryAutoTransition({ campaignId: String(campaign._id), tenantId: req.auth!.tenantId, fromStage: from, toStage: 'creator_approved', userId: req.auth!.userId })
      }
    }

    syncApplicationToSheet(application).catch((err) => console.error('Sheet sync error (application):', err))
    const latestSubmission = await findLatestSubmission(req.auth!.tenantId, application.campaignId, creator?._id)
    res.json({ application: { ...application.toJSON(), latestSubmission }, generatedPassword })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-25: pelacakan pembayaran ke creator — toggle manual, tanpa otomasi
router.patch('/:id/payment', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { creatorPaymentStatus } = req.body as { creatorPaymentStatus: 'unpaid' | 'paid' }
    if (!['unpaid', 'paid'].includes(creatorPaymentStatus)) {
      res.status(400).json({ message: 'creatorPaymentStatus harus unpaid atau paid' })
      return
    }
    const application = await Application.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId },
      { creatorPaymentStatus },
      { new: true }
    ).populate('creatorId', 'name phone')
    if (!application) { res.status(404).json({ message: 'Not found' }); return }

    // AD-30: trigger payment_completed (ke creator) saat ditandai paid
    if (creatorPaymentStatus === 'paid') {
      const creator = application.creatorId as unknown as { name: string; phone: string } | null
      const campaign = await Campaign.findOne({ _id: application.campaignId, tenantId: req.auth!.tenantId })
      if (creator?.phone && campaign) {
        const template = await getTemplate(req.auth!.tenantId, 'payment_completed')
        const payload = renderTemplate(template, { nama: creator.name, campaign: campaign.name })
        await enqueueWaMessage({ tenantId: req.auth!.tenantId, trigger: 'payment_completed', to: creator.phone, payload, campaignId: String(campaign._id) })
      }
    }

    syncApplicationToSheet(application).catch((err) => console.error('Sheet sync error (application):', err))
    res.json(application)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Assign/lepas PIC yang "pegang" creator ini di campaign — picUserId harus salah satu PIC yang
// sudah di-assign ke campaign (PicUser.campaignIds), supaya tidak bisa nunjuk PIC dari campaign lain.
// Kirim picUserId: null buat lepas assignment.
router.patch('/:id/pic', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { picUserId } = req.body as { picUserId: string | null }
    const application = await Application.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!application) { res.status(404).json({ message: 'Not found' }); return }

    if (picUserId) {
      const picUser = await PicUser.findOne({ _id: picUserId, tenantId: req.auth!.tenantId, campaignIds: application.campaignId })
      if (!picUser) {
        res.status(400).json({ message: 'PIC ini belum di-assign ke campaign ini' })
        return
      }
    }

    application.picUserId = picUserId ? (picUserId as unknown as typeof application.picUserId) : undefined
    await application.save()
    // Populate creatorId juga (bukan cuma picUserId) — respons ini dipakai frontend buat REPLACE
    // baris application di state, kalau creatorId gak ikut di-populate baris itu kehilangan
    // nama/WA/domisili/skor creator-nya (jadi "Creator dihapus" walau creator-nya masih ada).
    await application.populate('creatorId')
    await application.populate('picUserId', 'name email')
    const latestSubmission = await findLatestSubmission(req.auth!.tenantId, application.campaignId, application.creatorId)
    res.json({ ...application.toJSON(), latestSubmission })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

const REMINDER_TRIGGERS: WaTrigger[] = ['reminder_draft', 'reminder_upload', 'reminder_revision', 'reminder_insight', 'reminder_payment_creator']

// AD-30: kirim reminder manual ke creator (belum ada scheduler/deadline tracking, jadi admin yang trigger)
router.post('/:id/remind', async (req: AuthRequest, res: Response) => {
  try {
    const { trigger } = req.body as { trigger?: WaTrigger }
    if (!trigger || !REMINDER_TRIGGERS.includes(trigger)) {
      res.status(400).json({ message: `trigger harus salah satu dari: ${REMINDER_TRIGGERS.join(', ')}` })
      return
    }
    await connectDB()
    const application = await Application.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId }).populate('creatorId', 'name phone')
    if (!application) { res.status(404).json({ message: 'Not found' }); return }
    const creator = application.creatorId as unknown as { name: string; phone: string } | null
    const campaign = await Campaign.findOne({ _id: application.campaignId, tenantId: req.auth!.tenantId })
    if (!creator?.phone || !campaign) { res.status(400).json({ message: 'Creator atau campaign tidak lengkap' }); return }

    const template = await getTemplate(req.auth!.tenantId, trigger)
    const payload = renderTemplate(template, { nama: creator.name, campaign: campaign.name })
    const log = await enqueueWaMessage({ tenantId: req.auth!.tenantId, trigger, to: creator.phone, payload, campaignId: String(campaign._id) })
    res.status(201).json(log)
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim reminder', error: (err as Error).message })
  }
})

export default router
