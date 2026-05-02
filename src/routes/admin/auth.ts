import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { connectDB } from '../../lib/db'
import Admin from '../../models/Admin'

const router = Router()

router.post('/login', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { email, password } = req.body
    const admin = await Admin.findOne({ email })
    if (!admin) { res.status(401).json({ message: 'Invalid credentials' }); return }
    const valid = await bcrypt.compare(password, admin.password)
    if (!valid) { res.status(401).json({ message: 'Invalid credentials' }); return }
    const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
    res.json({ token, name: admin.name, email: admin.email })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
