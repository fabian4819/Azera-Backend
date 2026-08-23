import { Router, Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Application from './application.model'
import Creator from '../creators/creator.model'
import Campaign from '../campaigns/campaign.model'
import { enqueueWaMessage } from '../../lib/baileys'
import { getTemplate, renderTemplate } from '../whatsapp/template.service'
import { WaTrigger } from '../whatsapp/waTemplate.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce'))

// AD-19/20: daftar pendaftar per campaign, buat keputusan akhir admin
// Mounted di /api/admin/applications -> path lengkap /api/admin/applications/campaign/:campaignId
router.get('/campaign/:campaignId', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return }
    const applications = await Application.find({ tenantId: req.auth!.tenantId, campaignId: campaign._id })
      .populate('creatorId')
      .sort({ createdAt: -1 })
    res.json(applications)
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
    ).populate('creatorId')
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

    res.json({ application, generatedPassword })
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

    res.json(application)
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
