import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { requireAuth, requireRole, signPicToken, AuthRequest } from '../../middleware/auth'
import PicUser from './pic.model'
import Tenant from '../tenants/tenant.model'
import { Types } from 'mongoose'
import Campaign, { shortApplyCode } from '../campaigns/campaign.model'
import Application from '../applications/application.model'
import { isFullyApproved } from '../../lib/sheetSync.service'
import { env } from '../../config/env'
import { getCampaignDashboardData } from '../campaigns/dashboard.service'
import { getCampaignTabUrl } from '../../lib/googleSheets'
import { uploadProof } from '../../middleware/upload'
import { uploadToCloudinary } from '../../lib/cloudinary'

// PIC/Handle-by account, sign up tanpa accessCode, akun dibuat kosong
// (campaignIds: []). Admin yang assign campaign ke akun ini (lihat endpoint
// /:id/pic di campaign.routes.ts), baru muncul di dashboard PIC.
export const picAuthRouter = Router()

// KTP: gambar/PDF maks 5MB; error multer (tipe/ukuran) dibalikin 400, bukan 500
const ktpUpload = (req: Request, res: Response, next: () => void) =>
  uploadProof.single('ktp')(req, res, (err: unknown) => {
    if (err) { res.status(400).json({ message: 'KTP harus gambar atau PDF, maksimal 5MB' }); return }
    next()
  })

picAuthRouter.post('/register', ktpUpload, async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { name, city, ownerName, position, email, password, phone, backupPhone, socialMedia, portfolio, authorized, dataConsent } = req.body as Record<string, string | undefined>
    if (!name?.trim() || !city?.trim() || !ownerName?.trim() || !position?.trim() || !email || !password || !phone) {
      res.status(400).json({ message: 'Nama & kota management/agency, nama & jabatan PIC, email, WhatsApp, dan password wajib diisi' })
      return
    }
    if (authorized !== 'true' || dataConsent !== 'true') {
      res.status(400).json({ message: 'Pernyataan kewenangan dan persetujuan penggunaan data wajib dicentang' })
      return
    }
    if (!req.file) {
      res.status(400).json({ message: 'Upload KTP wajib' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ message: 'Password minimal 6 karakter' })
      return
    }
    const tenant = await getDefaultTenant()
    const existing = await PicUser.findOne({ tenantId: tenant._id, email })
    if (existing) {
      res.status(409).json({ message: 'Email sudah terdaftar' })
      return
    }
    const hashed = await bcrypt.hash(password, 10)
    // ponytail: KTP di Cloudinary pakai URL publik tak tertebak (sama seperti bukti transfer); pindah ke type 'authenticated' + signed URL kalau perlu lebih ketat
    const ktpUrl = await uploadToCloudinary(req.file.buffer, 'pic-ktp')
    const picUser = await PicUser.create({
      tenantId: tenant._id, name: name.trim(), city: city.trim(), ownerName: ownerName.trim(), position: position.trim(), email, phone,
      backupPhone: backupPhone?.trim() || undefined, password: hashed, socialMedia: socialMedia?.trim() || undefined,
      portfolio: portfolio?.trim() || undefined, ktpUrl, consentAt: new Date(), campaignIds: [],
    })
    const token = signPicToken(String(picUser._id), String(picUser.tenantId))
    res.status(201).json({ token, pic: { name: picUser.name, email: picUser.email } })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

picAuthRouter.post('/login', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { email, password } = req.body
    const tenant = await getDefaultTenant()
    const picUser = await PicUser.findOne({ tenantId: tenant._id, email })
    if (!picUser) {
      res.status(401).json({ message: 'Invalid credentials' })
      return
    }
    const valid = await bcrypt.compare(password, picUser.password)
    if (!valid) {
      res.status(401).json({ message: 'Invalid credentials' })
      return
    }
    const token = signPicToken(String(picUser._id), String(picUser.tenantId))
    res.json({ token, pic: { name: picUser.name, email: picUser.email } })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export const picPortalRouter = Router()
picPortalRouter.use(requireAuth, requireRole('pic'))

// Daftar campaign PIC + angka yang PIC butuhkan: creator yang dia bawa (lolos admin & client),
// estimasi fee PIC, status bayar, link daftar untuk disebar. Budget campaign sengaja tidak dikirim.
picPortalRouter.get('/campaigns', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const picUser = await PicUser.findById(req.auth!.userId)
    if (!picUser) {
      res.status(404).json({ message: 'Not found' })
      return
    }
    const campaigns = await Campaign.find({ tenantId: picUser.tenantId, _id: { $in: picUser.campaignIds } })
      .select('name status workflowStage timeline brandId fee applyOpen applySlug createdAt')
      .populate('brandId', 'namaBrand')
      .sort({ createdAt: -1 })
    const apps = await Application.find({ tenantId: picUser.tenantId, picUserId: picUser._id, campaignId: { $in: picUser.campaignIds } })
      .select('campaignId status clientApprovalStatus')
    const paid = new Set(picUser.paidCampaignIds.map(String))
    res.json(campaigns.map((c) => {
      const mine = apps.filter((a) => String(a.campaignId) === String(c._id))
      const creators = mine.filter(isFullyApproved).length
      const picFee = c.fee?.picFee ?? 0
      return {
        _id: c._id, name: c.name, status: c.status, workflowStage: c.workflowStage, timeline: c.timeline,
        brandId: c.brandId, applyOpen: c.applyOpen,
        applyUrl: c.applyOpen ? `${env.clientOrigin}/apply/${shortApplyCode(c.applySlug)}` : undefined,
        registrants: mine.length, creators, picFee, totalFee: picFee * creators, paid: paid.has(String(c._id)),
      }
    }))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Top PIC bulan ini (jumlah pendaftar yang dibawa, semua campaign), untuk leaderboard di portal PIC
picPortalRouter.get('/leaderboard', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 7 * 3600_000) // awal bulan WIB
    const ranks = await Application.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { tenantId: new Types.ObjectId(req.auth!.tenantId), picUserId: { $exists: true, $ne: null }, createdAt: { $gte: monthStart } } },
      { $group: { _id: '$picUserId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    const names = new Map((await PicUser.find({ tenantId: req.auth!.tenantId, _id: { $in: ranks.slice(0, 10).map((r) => r._id) } }).select('name')).map((p) => [String(p._id), p.name]))
    const myIndex = ranks.findIndex((r) => String(r._id) === req.auth!.userId)
    res.json({
      top: ranks.slice(0, 10).map((r, i) => ({ rank: i + 1, name: names.get(String(r._id)) || '-', count: r.count, me: String(r._id) === req.auth!.userId })),
      me: myIndex === -1 ? null : { rank: myIndex + 1, count: ranks[myIndex].count },
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

const PROFILE_FIELDS = 'name city ownerName position email phone backupPhone socialMedia portfolio paymentInfo createdAt'
const EDITABLE_PROFILE = ['city', 'ownerName', 'position', 'phone', 'backupPhone', 'socialMedia', 'portfolio'] as const
const EDITABLE_PAYMENT = ['methodName', 'accountNumber', 'accountName'] as const

picPortalRouter.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const [picUser, tenant] = await Promise.all([PicUser.findById(req.auth!.userId).select(PROFILE_FIELDS), Tenant.findById(req.auth!.tenantId).select('settings.picGroupLink')])
    if (!picUser) { res.status(404).json({ message: 'Not found' }); return }
    res.json({ ...picUser.toJSON(), picGroupLink: tenant?.settings?.picGroupLink || '' })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// PIC ubah data sendiri, termasuk rekening/e-wallet (dulu cuma lewat chat admin). Nama MG & email
// login tetap lewat admin: nama dipakai sebagai label PIC di form & rekap.
picPortalRouter.patch('/me', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const picUser = await PicUser.findById(req.auth!.userId)
    if (!picUser) { res.status(404).json({ message: 'Not found' }); return }
    const body = req.body as Record<string, unknown>
    for (const f of EDITABLE_PROFILE) {
      if (typeof body[f] === 'string') picUser.set(f, (body[f] as string).trim().slice(0, 300) || undefined)
    }
    if (!picUser.phone) { res.status(400).json({ message: 'Nomor WhatsApp wajib diisi' }); return }
    const pay = body.paymentInfo as Record<string, unknown> | undefined
    if (pay && typeof pay === 'object') {
      const next = Object.fromEntries(EDITABLE_PAYMENT.map((f) => [f, typeof pay[f] === 'string' ? (pay[f] as string).trim().slice(0, 120) : picUser.paymentInfo?.[f]]))
      if (EDITABLE_PAYMENT.some((f) => next[f] !== picUser.paymentInfo?.[f])) picUser.paymentInfo = { ...next, updatedAt: new Date() }
    }
    await picUser.save()
    res.json(await PicUser.findById(picUser._id).select(PROFILE_FIELDS))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

picPortalRouter.get('/campaigns/:id/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const picUser = await PicUser.findById(req.auth!.userId)
    if (!picUser || !picUser.campaignIds.some((cid) => String(cid) === req.params.id)) {
      res.status(404).json({ message: 'Campaign tidak ditemukan' })
      return
    }
    const campaign = await Campaign.findById(req.params.id).populate('brandId', 'namaBrand')
    if (!campaign) {
      res.status(404).json({ message: 'Campaign tidak ditemukan' })
      return
    }
    const data = await getCampaignDashboardData(campaign, req.auth!.userId)
    // masterSheetUrl cuma ditambah di sini (akun PIC login, sudah authenticated), BUKAN di
    // getCampaignDashboardData itu sendiri, fungsi itu juga dipakai publicCampaign.routes.ts
    // (akses-kode publik, tanpa login) yang tidak boleh bocorin link spreadsheet internal.
    // Cuma master sheet yang ditampilkan ke PIC, report & recap payment cuma di dashboard admin.
    const masterSheetUrl = await getCampaignTabUrl(campaign.name)
    res.json({ ...data, masterSheetUrl })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Daftar akun PIC/Handle-by untuk menu admin, dipakai buat cari email saat assign ke campaign.
export const picAdminRouter = Router()
picAdminRouter.use(requireAuth, requireRole('owner', 'admin', 'ce'))

// Link grup WA PIC (tampil di portal PIC setelah daftar)
picAdminRouter.get('/settings', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tenant = await Tenant.findById(req.auth!.tenantId).select('settings.picGroupLink')
    res.json({ picGroupLink: tenant?.settings?.picGroupLink || '' })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

picAdminRouter.put('/settings', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const link = String(req.body.picGroupLink ?? '').trim()
    if (link && !/^https:\/\/chat\.whatsapp\.com\/\S+$/.test(link)) { res.status(400).json({ message: 'Link harus link undangan grup WhatsApp (https://chat.whatsapp.com/...)' }); return }
    await Tenant.updateOne({ _id: req.auth!.tenantId }, { 'settings.picGroupLink': link || undefined })
    res.json({ picGroupLink: link })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

picAdminRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const picUsers = await PicUser.find({ tenantId: req.auth!.tenantId })
      .select('name city ownerName position email phone backupPhone socialMedia portfolio ktpUrl campaignIds createdAt')
      .populate('campaignIds', 'name')
      .sort({ createdAt: -1 })
    res.json(picUsers)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

