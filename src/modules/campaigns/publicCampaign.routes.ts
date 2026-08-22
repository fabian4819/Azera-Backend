import { Router, Request, Response } from 'express'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import Campaign from './campaign.model'
import Creator from '../creators/creator.model'
import Application from '../applications/application.model'
import { runSmartCuration } from '../applications/curation.service'

const router = Router()

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
      answers,
    } = req.body

    if (!phone || !name) {
      res.status(400).json({ message: 'Nama dan nomor WA wajib diisi' })
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
