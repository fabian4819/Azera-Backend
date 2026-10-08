import { Router, Request, Response } from 'express'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import crypto from 'crypto'
import { Types } from 'mongoose'
import Campaign, { ICampaign } from './campaign.model'
import Creator, { type SocialPlatform } from '../creators/creator.model'
import Application from '../applications/application.model'
import PicUser from '../pic/pic.model'
import { runSmartCuration } from '../applications/curation.service'
import { buildPortalView } from './sheetView.service'
import { reviewSubmission, CellError } from './progress.service'
import { syncApplicationToSheet, creatorAccess } from '../../lib/sheetSync.service'

const router = Router()

/** Kode akses dibanding constant-time; kode kosong/tidak ada = selalu ditolak. */
function codeMatches(expected: string | undefined, given: unknown): boolean {
  if (!expected || typeof given !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Campaign untuk dashboard PIC (accessCode) / client (clientAccessCode), 404 kalau kode salah. */
async function loadBoardCampaign(id: string, code: unknown, role: 'pic' | 'client') {
  const tenant = await getDefaultTenant()
  if (!Types.ObjectId.isValid(id)) return null
  const campaign = await Campaign.findOne({ tenantId: tenant._id, _id: id }).populate('brandId', 'namaBrand')
  if (!campaign || !codeMatches(role === 'pic' ? campaign.accessCode : campaign.clientAccessCode, code)) return null
  return { tenant, campaign }
}

function boardCampaignInfo(campaign: ICampaign, withGroup: boolean) {
  const brand = campaign.brandId as unknown as { namaBrand?: string } | null
  return {
    name: campaign.name,
    brandName: brand?.namaBrand ?? null,
    briefContent: campaign.briefContent || '',
    deliverables: campaign.deliverables,
    timeline: campaign.timeline,
    waGroupLink: withGroup ? campaign.waGroupLink || '' : '',
  }
}

/**
 * AD-48: dashboard PIC/Handle-by via accessCode (tanpa login). Isinya tabel yang sama dengan
 * dashboard creator (kolom sesuai aturan akses admin), read-only.
 */
router.get('/:id/dashboard', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const found = await loadBoardCampaign(req.params.id, req.query.code, 'pic')
    if (!found) { res.status(404).json({ message: 'Campaign tidak ditemukan' }); return }
    res.json({ campaign: boardCampaignInfo(found.campaign, true), ...(await buildPortalView(found.tenant._id, found.campaign, { role: 'pic' })) })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/** Dashboard client: kolom sama dengan dashboard creator, yang bisa diubah cuma status draft & posting (+ catatan revisi). */
router.get('/:id/client', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const found = await loadBoardCampaign(req.params.id, req.query.code, 'client')
    if (!found) { res.status(404).json({ message: 'Campaign tidak ditemukan' }); return }
    res.json({ campaign: boardCampaignInfo(found.campaign, false), ...(await buildPortalView(found.tenant._id, found.campaign, { role: 'client' })) })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.patch('/:id/client/review', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const found = await loadBoardCampaign(req.params.id, req.body.code, 'client')
    if (!found) { res.status(404).json({ message: 'Campaign tidak ditemukan' }); return }
    const { tenant, campaign } = found
    const application = Types.ObjectId.isValid(String(req.body.applicationId))
      ? await Application.findOne({ tenantId: tenant._id, campaignId: campaign._id, _id: req.body.applicationId, status: 'accepted' })
      : null
    if (!application) { res.status(404).json({ message: 'Baris tidak ditemukan' }); return }
    // Kolom status disembunyikan admin dari dashboard = client juga tidak boleh mengubahnya
    const key = req.body.type === 'draft' ? 'Status Draft' : 'Status Posting'
    if (creatorAccess(campaign, { key, label: key }) === 'hidden') { res.status(403).json({ message: 'Kolom ini tidak bisa diubah' }); return }
    await reviewSubmission({ tenantId: tenant._id, campaign, application, actor: 'admin', userId: application.creatorId }, req.body.type, req.body.status, req.body.notes)
    res.json({ ok: true })
  } catch (err) {
    if (err instanceof CellError) { res.status(err.status).json({ message: err.message }); return }
    console.error('Client review error:', err)
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-19: halaman publik /apply/:slug, info campaign untuk ditampilkan di landing page
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const tenant = await getDefaultTenant()
    const campaign = await Campaign.findOne({ tenantId: tenant._id, applySlug: req.params.slug })
      .populate('brandId', 'namaBrand')
    if (!campaign) {
      res.status(404).json({ message: 'Campaign tidak ditemukan' })
      return
    }
    // Ditutup admin (kebutuhan creator terpenuhi) → 410 + nama campaign, frontend tampilkan halaman "sudah ditutup"
    if (!campaign.applyOpen) {
      res.status(410).json({ closed: true, name: campaign.name, brand: campaign.brandId })
      return
    }
    // AD-50: PIC/partner dipilih CREATOR sendiri di apply form (bukan admin pasca-review),
    // pilihannya dibatasi ke PIC yang sudah di-assign admin ke campaign ini (PicUser.campaignIds).
    const applyFields = campaign.applyFields ?? { pic: true, handleBy: true, handleByRequired: false }
    const picUsers = applyFields.pic ? await PicUser.find({ tenantId: tenant._id, campaignIds: campaign._id }).select('name') : []
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
      applyFields,
      picOptions: picUsers.map((p) => ({ _id: p._id, name: p.name })),
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// AD-19: submit pendaftaran creator ke campaign, buat/link Creator by nomor WA
router.post('/:slug/apply', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const tenant = await getDefaultTenant()
    const campaign = await Campaign.findOne({ tenantId: tenant._id, applySlug: req.params.slug })
    if (!campaign) {
      res.status(404).json({ message: 'Campaign tidak ditemukan' })
      return
    }
    if (!campaign.applyOpen) {
      res.status(410).json({ closed: true, message: 'Pendaftaran campaign ini sudah ditutup' })
      return
    }

    // Form Apply cukup field default (nama/WA/email + PIC/Handle by) + pertanyaan custom,
    // creator tidak wajib isi Form Creator (/kol/register) dulu.
    const { customAnswers, picUserId } = req.body
    const name = String(req.body.name ?? '').trim()
    const phone = String(req.body.phone ?? '').trim()
    const email = String(req.body.email ?? '').trim().toLowerCase()
    const handleBy = String(req.body.handleBy ?? '').trim().slice(0, 120)
    const applyFields = campaign.applyFields ?? { pic: true, handleBy: true, handleByRequired: false }

    if (!name || !phone || !email) {
      res.status(400).json({ message: 'Nama, nomor WA, dan email wajib diisi' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ message: 'Format email tidak valid' })
      return
    }
    if (applyFields.handleBy && applyFields.handleByRequired && !handleBy) {
      res.status(400).json({ message: 'Handle by wajib diisi' })
      return
    }

    // Field default wajib untuk Smart Curation: niche, provinsi, dan akun (username + followers) untuk
    // TIAP platform yang dicentang admin di kriteria campaign. Disimpan ke profil Creator di bawah.
    const niches = Array.isArray(req.body.niches) ? req.body.niches.map((n: unknown) => String(n).trim()).filter(Boolean).slice(0, 20) : []
    const province = String(req.body.province ?? '').trim().slice(0, 80)
    const city = String(req.body.city ?? '').trim().slice(0, 80)
    const socialsIn: { platform?: string; username?: string; followers?: unknown }[] = Array.isArray(req.body.socials) ? req.body.socials : []
    const campaignPlatforms = (campaign.criteria?.platforms || []) as SocialPlatform[]
    const socials = campaignPlatforms.map((platform) => {
      const s = socialsIn.find((x) => x.platform === platform)
      const followers = Number(s?.followers)
      return { platform, username: String(s?.username ?? '').trim().replace(/^@+/, '').slice(0, 100), followers: Number.isFinite(followers) && followers >= 0 ? Math.floor(followers) : NaN }
    })
    // Provinsi & kota cuma ditanya (dan wajib) kalau campaign punya kriteria provinsi/kota
    const askDomicile = (campaign.criteria?.provinces?.length || 0) + (campaign.criteria?.cities?.length || 0) > 0
    if (!niches.length) {
      res.status(400).json({ message: 'Niche wajib diisi' })
      return
    }
    if (askDomicile && (!province || !city)) {
      res.status(400).json({ message: 'Provinsi dan kota wajib diisi' })
      return
    }
    const badSocial = socials.find((s) => !s.username || Number.isNaN(s.followers))
    if (badSocial) {
      res.status(400).json({ message: `Username & jumlah followers ${badSocial.platform} wajib diisi` })
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

    // AD-50: PIC wajib diisi HANYA kalau field PIC aktif & campaign ini punya PIC yang di-assign admin.
    let validatedPicUserId: string | undefined
    if (applyFields.pic) {
      const assignedPics = await PicUser.find({ tenantId: tenant._id, campaignIds: campaign._id }).select('_id')
      if (assignedPics.length > 0) {
        const match = assignedPics.find((p) => String(p._id) === String(picUserId))
        if (!match) {
          res.status(400).json({ message: 'PIC/Partner wajib dipilih' })
          return
        }
        validatedPicUserId = String(match._id)
      }
    }

    // Duplikat (nomor WA sama) → link ke Creator profile eksisting, bukan bikin baru
    let creator = await Creator.findOne({ tenantId: tenant._id, phone })
    const emailOwner = await Creator.findOne({ tenantId: tenant._id, email })
    if (emailOwner && String(emailOwner._id) !== String(creator?._id)) {
      res.status(409).json({ message: 'Email ini sudah terdaftar dengan nomor WA lain. Gunakan email lain, atau hubungi tim kami kalau ini email kamu.' })
      return
    }
    if (!creator) {
      creator = await Creator.create({ tenantId: tenant._id, name, phone, email, source: 'campaign' })
    } else if (!creator.email) {
      creator.email = email
    } else if (req.body.updateName === true && creator.email === email && name !== creator.name) {
      // Creator memilih "pakai nama yang barusan diketik" di form, hanya kalau WA & email sama-sama cocok
      creator.name = name.slice(0, 120)
    }
    // Data terbaru dari form menimpa profil: niche & domisili, akun per platform diganti (platform lain dibiarkan)
    creator.niches = niches
    if (askDomicile) creator.domicile = { ...(creator.domicile || {}), province, city }
    creator.socials = [...(creator.socials || []).filter((s) => !campaignPlatforms.includes(s.platform)), ...socials]
    await creator.save()

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
      customAnswers: customAnswers || {},
      picUserId: validatedPicUserId,
      handleBy: applyFields.handleBy ? handleBy || undefined : undefined,
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
