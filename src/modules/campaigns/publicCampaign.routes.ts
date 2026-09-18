import { Router, Request, Response } from 'express'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import Campaign from './campaign.model'
import Creator from '../creators/creator.model'
import Application from '../applications/application.model'
import PicUser from '../pic/pic.model'
import { runSmartCuration } from '../applications/curation.service'
import { getCampaignDashboardData } from './dashboard.service'
import { syncApplicationToSheet } from '../../lib/sheetSync.service'

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

    res.json(await getCampaignDashboardData(campaign))
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
    // AD-50: PIC/partner dipilih CREATOR sendiri di apply form (bukan admin pasca-review) —
    // pilihannya dibatasi ke PIC yang sudah di-assign admin ke campaign ini (PicUser.campaignIds).
    const picUsers = await PicUser.find({ tenantId: tenant._id, campaignIds: campaign._id }).select('name')
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
      picOptions: picUsers.map((p) => ({ _id: p._id, name: p.name })),
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
      name, phone, email, birthDate, gender, domicile, socials, activities, niches, nicheOther,
      contentStyles, contentStyleOther, bankAccount, npwp, mediaKitUrl, portfolioLink,
      address, postalCode, school,
      answers, customAnswers, picUserId,
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

    // AD-50: PIC wajib diisi HANYA kalau campaign ini punya PIC yang di-assign admin — campaign
    // lama/tanpa PIC sama sekali tidak kena validasi ini (backward compatible).
    const assignedPics = await PicUser.find({ tenantId: tenant._id, campaignIds: campaign._id }).select('_id')
    let validatedPicUserId: string | undefined
    if (assignedPics.length > 0) {
      const match = assignedPics.find((p) => String(p._id) === String(picUserId))
      if (!match) {
        res.status(400).json({ message: 'PIC/Partner wajib dipilih' })
        return
      }
      validatedPicUserId = String(match._id)
    }

    // Duplikat (nomor WA sama) → link ke Creator profile eksisting, bukan bikin baru
    let creator = await Creator.findOne({ tenantId: tenant._id, phone })
    if (!creator) {
      // Nomor WA baru, tapi email-nya sudah dipakai akun lain — sama seperti publicCreator.routes.ts
      if (email) {
        const emailTaken = await Creator.findOne({ tenantId: tenant._id, email })
        if (emailTaken) {
          res.status(409).json({ message: 'Email ini sudah terdaftar dengan akun lain. Gunakan email lain, atau hubungi tim kami kalau ini email kamu.' })
          return
        }
      }
      creator = await Creator.create({
        tenantId: tenant._id,
        name, phone, email, gender, domicile,
        birthDate: birthDate ? new Date(birthDate) : undefined,
        socials: socials || [],
        activities: activities || [],
        niches: niches || [],
        nicheOther,
        contentStyles: contentStyles || [],
        contentStyleOther,
        bankAccount, npwp, mediaKitUrl, portfolioLink,
        address, postalCode, school,
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
      picUserId: validatedPicUserId,
      curationResult: curation.result,
      curationReason: curation.reason,
      status: curation.autoRejected ? 'rejected' : 'pending',
      decidedAt: curation.autoRejected ? new Date() : undefined,
    })
    syncApplicationToSheet(application).catch((err) => console.error('Sheet sync error (application):', err))

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
