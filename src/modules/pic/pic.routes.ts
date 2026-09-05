import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { requireAuth, requireRole, signPicToken, AuthRequest } from '../../middleware/auth'
import PicUser from './pic.model'
import Campaign from '../campaigns/campaign.model'
import { getCampaignDashboardData } from '../campaigns/dashboard.service'

// PIC/Handle-by account — satu akun bisa terhubung ke banyak campaign lewat
// accessCode masing-masing campaign (bukan hierarki akun per campaign).
export const picAuthRouter = Router()

picAuthRouter.post('/register', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { name, email, password, accessCode } = req.body
    if (!name || !email || !password || !accessCode) {
      res.status(400).json({ message: 'Nama, email, password, dan kode akses campaign wajib diisi' })
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
    const campaign = await Campaign.findOne({ tenantId: tenant._id, accessCode })
    if (!campaign) {
      res.status(404).json({ message: 'Kode akses campaign tidak valid' })
      return
    }
    const hashed = await bcrypt.hash(password, 10)
    const picUser = await PicUser.create({
      tenantId: tenant._id, name, email, password: hashed, campaignIds: [campaign._id],
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

// Hubungkan campaign tambahan ke akun PIC yang sudah ada, pakai accessCode campaign itu.
picPortalRouter.post('/campaigns/link', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { accessCode } = req.body
    if (!accessCode) {
      res.status(400).json({ message: 'Kode akses wajib diisi' })
      return
    }
    const campaign = await Campaign.findOne({ tenantId: req.auth!.tenantId, accessCode })
    if (!campaign) {
      res.status(404).json({ message: 'Kode akses campaign tidak valid' })
      return
    }
    const picUser = await PicUser.findById(req.auth!.userId)
    if (!picUser) {
      res.status(404).json({ message: 'Not found' })
      return
    }
    const alreadyLinked = picUser.campaignIds.some((cid) => String(cid) === String(campaign._id))
    if (!alreadyLinked) {
      picUser.campaignIds.push(campaign._id)
      await picUser.save()
    }
    res.json({ message: alreadyLinked ? 'Campaign sudah terhubung' : 'Campaign berhasil ditambahkan' })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

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
