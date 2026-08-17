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
