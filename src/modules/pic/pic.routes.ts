import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { requireAuth, requireRole, signPicToken, AuthRequest } from '../../middleware/auth'
import PicUser from './pic.model'
import Campaign from '../campaigns/campaign.model'
import { getCampaignDashboardData } from '../campaigns/dashboard.service'

// PIC/Handle-by account — sign up tanpa accessCode, akun dibuat kosong
// (campaignIds: []). Admin yang assign campaign ke akun ini (lihat endpoint
// /:id/pic di campaign.routes.ts), baru muncul di dashboard PIC.
export const picAuthRouter = Router()

picAuthRouter.post('/register', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { name, email, password, phone } = req.body
    if (!name || !email || !password || !phone) {
      res.status(400).json({ message: 'Nama, nomor WhatsApp, email, dan password wajib diisi' })
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
    const picUser = await PicUser.create({
      tenantId: tenant._id, name, email, phone, password: hashed, campaignIds: [],
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

picPortalRouter.get('/campaigns', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const picUser = await PicUser.findById(req.auth!.userId).populate({
      path: 'campaignIds',
      select: 'name status workflowStage budget timeline brandId',
      populate: { path: 'brandId', select: 'namaBrand' },
    })
    if (!picUser) {
      res.status(404).json({ message: 'Not found' })
      return
    }
    res.json(picUser.campaignIds)
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
    res.json(await getCampaignDashboardData(campaign))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Daftar akun PIC/Handle-by untuk menu admin — dipakai buat cari email saat assign ke campaign.
export const picAdminRouter = Router()
picAdminRouter.use(requireAuth, requireRole('owner', 'admin', 'ce'))

picAdminRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const picUsers = await PicUser.find({ tenantId: req.auth!.tenantId })
      .select('name email phone campaignIds createdAt')
      .populate('campaignIds', 'name')
      .sort({ createdAt: -1 })
    res.json(picUsers)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})
