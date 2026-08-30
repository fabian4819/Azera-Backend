import { Router, Request, Response } from 'express'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import Campaign from './campaign.model'
import Creator from '../creators/creator.model'
import Application from '../applications/application.model'
import Submission from '../submissions/submission.model'
import CreatorHistory from '../creators/creatorHistory.model'
import { runSmartCuration } from '../applications/curation.service'

const router = Router()

/**
 * AD-48: dashboard PIC/Handle-by — bukan akun/login individual (jumlah Handle-by
 * terlalu banyak untuk dikelola sebagai User), cukup satu accessCode per campaign
 * (sudah ada di schema sejak AD-18, baru dipakai sekarang), pola sama seperti akses
 * invoice via code (publicInvoice.routes.ts). Read-only, seluruh data campaign
 * (bukan cuma subset per orang) — lihat docs/plan/09-open-questions.md.
 */
router.get('/:id/dashboard', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { code } = req.query
    const campaign = await Campaign.findById(req.params.id).populate('brandId', 'namaBrand')
    if (!campaign || campaign.accessCode !== code) {
      res.status(404).json({ message: 'Campaign tidak ditemukan' })
      return
    }

    const [applications, submissions, histories] = await Promise.all([
      Application.find({ tenantId: campaign.tenantId, campaignId: campaign._id })
        .populate('creatorId', 'name phone domicile socials niches performanceScore')
        .sort({ createdAt: -1 }),
      Submission.find({ tenantId: campaign.tenantId, campaignId: campaign._id }).sort({ createdAt: -1 }),
      CreatorHistory.find({ tenantId: campaign.tenantId, campaignId: campaign._id }).sort({ createdAt: -1 }),
    ])

    res.json({
      campaign: {
        name: campaign.name,
        brand: campaign.brandId,
        workflowStage: campaign.workflowStage,
        status: campaign.status,
        budget: campaign.budget,
        timeline: campaign.timeline,
      },
      applications,
      submissions,
      histories,
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-19: halaman publik /apply/:slug — info campaign untuk ditampilkan di landing page
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const tenant = await getDefaultTenant()
    const campaign = await Campaign.findOne({ tenantId: tenant._id, applySlug: req.params.slug })
      .populate('brandId', 'namaBrand')
    if (!campaign || !campaign.applyOpen) {
      res.status(404).json({ message: 'Campaign tidak ditemukan atau pendaftaran sudah ditutup' })
      return
    }
    res.json({
      name: campaign.name,
      brand: campaign.brandId,
      briefContent: campaign.briefContent,
      deliverables: campaign.deliverables,
      criteria: campaign.criteria,
      type: campaign.type,
      eventDetails: campaign.eventDetails,
      timeline: campaign.timeline,
      customFields: campaign.customFields,
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-19: submit pendaftaran creator ke campaign — buat/link Creator by nomor WA
router.post('/:slug/apply', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const tenant = await getDefaultTenant()
    const campaign = await Campaign.findOne({ tenantId: tenant._id, applySlug: req.params.slug })
    if (!campaign || !campaign.applyOpen) {
      res.status(404).json({ message: 'Campaign tidak ditemukan atau pendaftaran sudah ditutup' })
      return
    }

    const {
      name, phone, gender, domicile, socials, activities, niches, nicheOther,
      contentStyles, contentStyleOther, bankAccount, npwp, mediaKitUrl, portfolioLink,
      answers, customAnswers,
    } = req.body

    if (!phone || !name) {
      res.status(400).json({ message: 'Nama dan nomor WA wajib diisi' })
      return
    }

    // AD-47: validasi pertanyaan custom yang wajib diisi
    const missingRequired = (campaign.customFields || []).filter((f) => {
      if (!f.required) return false
      const v = customAnswers?.[f.id]
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
    })
    if (missingRequired.length > 0) {
      res.status(400).json({ message: `Wajib diisi: ${missingRequired.map((f) => f.label).join(', ')}` })
      return
    }

    // Duplikat (nomor WA sama) → link ke Creator profile eksisting, bukan bikin baru
    let creator = await Creator.findOne({ tenantId: tenant._id, phone })
    if (!creator) {
      creator = await Creator.create({
        tenantId: tenant._id,
        name, phone, gender, domicile,
        socials: socials || [],
        activities: activities || [],
        niches: niches || [],
        nicheOther,
        contentStyles: contentStyles || [],
        contentStyleOther,
        bankAccount, npwp, mediaKitUrl, portfolioLink,
        source: 'form',
      })
    }

    const existingApplication = await Application.findOne({
      tenantId: tenant._id,
      campaignId: campaign._id,
      creatorId: creator._id,
    })
    if (existingApplication) {
      res.status(409).json({ message: 'Kamu sudah terdaftar di campaign ini' })
      return
    }

    const curation = await runSmartCuration(campaign, creator, tenant._id)
    const application = await Application.create({
      tenantId: tenant._id,
      campaignId: campaign._id,
      creatorId: creator._id,
      answers: answers || {},
      customAnswers: customAnswers || {},
      curationResult: curation.result,
      curationReason: curation.reason,
      status: curation.autoRejected ? 'rejected' : 'pending',
      decidedAt: curation.autoRejected ? new Date() : undefined,
    })

    res.status(201).json({
      message: curation.autoRejected
        ? 'Pendaftaran diterima sistem, tapi belum memenuhi syarat saat ini.'
        : 'Pendaftaran berhasil, menunggu review dari tim.',
      applicationId: application._id,
      status: application.status,
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: (err as Error).message })
  }
})

export default router
