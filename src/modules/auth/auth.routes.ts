import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { connectDB } from '../../db/connect'
import User from '../users/user.model'
import Creator from '../creators/creator.model'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { signStaffToken, signCreatorToken } from '../../middleware/auth'

// Staff login (owner/admin/ce/finance) — path dipertahankan sama dengan yang lama
// (/api/admin/login) supaya client/src/pages/admin/Login.tsx tidak perlu berubah.
export const staffAuthRouter = Router()

staffAuthRouter.post('/login', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { email, password } = req.body
    const tenant = await getDefaultTenant()
    const user = await User.findOne({ tenantId: tenant._id, email, active: true })
    if (!user) {
      res.status(401).json({ message: 'Invalid credentials' })
      return
    }
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      res.status(401).json({ message: 'Invalid credentials' })
      return
    }
    const token = signStaffToken(String(user._id), String(user.tenantId), user.role)
    res.json({ token, admin: { name: user.name, email: user.email, role: user.role } })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Creator (talent) login — nomor WA + password yang di-set saat diterima campaign
export const creatorAuthRouter = Router()

// Dipakai form sign up creator: sebelum minta email, cek dulu apakah nomor WA ini sudah
// terdaftar (via /kol/register) dan sudah punya email atau belum — creator lama (sebelum
// field email ada di form KOL) mungkin belum punya, creator baru biasanya sudah.
creatorAuthRouter.get('/check-phone', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const phone = String(req.query.phone || '')
    if (!phone) {
      res.status(400).json({ message: 'Nomor WA wajib diisi' })
      return
    }
    const tenant = await getDefaultTenant()
    const creator = await Creator.findOne({ tenantId: tenant._id, phone })
    res.json({ registered: !!creator, hasEmail: !!creator?.email })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Self-service: creator yang sudah terdaftar (via /kol/register) tapi belum punya
// password bisa set password sendiri, tanpa nunggu admin. Sekali di-set, endpoint
// ini tidak bisa dipakai lagi untuk akun yang sama (bukan reset password).
// Email cuma wajib kalau creator-nya belum punya (creator lama pra-field-email di form KOL).
creatorAuthRouter.post('/register-password', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { phone, password, email } = req.body
    if (!phone || !password) {
      res.status(400).json({ message: 'Nomor WA dan password wajib diisi' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ message: 'Password minimal 6 karakter' })
      return
    }
    const tenant = await getDefaultTenant()
    const creator = await Creator.findOne({ tenantId: tenant._id, phone })
    if (!creator) {
      res.status(404).json({ message: 'Nomor WA belum terdaftar. Daftar dulu lewat form KOL.' })
      return
    }
    if (creator.password) {
      res.status(409).json({ message: 'Akun ini sudah punya password. Hubungi admin untuk reset.' })
      return
    }
    if (!creator.email && !email) {
      res.status(400).json({ message: 'Email wajib diisi' })
      return
    }
    creator.password = await bcrypt.hash(password, 10)
    if (!creator.email && email) creator.email = email
    await creator.save()
    const token = signCreatorToken(String(creator._id), String(creator.tenantId))
    res.status(201).json({ token, creator: { name: creator.name, phone: creator.phone } })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

creatorAuthRouter.post('/login', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { phone, password } = req.body
    const tenant = await getDefaultTenant()
    const creator = await Creator.findOne({ tenantId: tenant._id, phone })
    if (!creator || !creator.password) {
      res.status(401).json({ message: 'Invalid credentials' })
      return
    }
    const valid = await bcrypt.compare(password, creator.password)
    if (!valid) {
      res.status(401).json({ message: 'Invalid credentials' })
      return
    }
    const token = signCreatorToken(String(creator._id), String(creator.tenantId))
    res.json({ token, creator: { name: creator.name, phone: creator.phone } })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})
