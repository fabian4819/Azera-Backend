import { Router, Request, Response } from 'express'
import { connectDB } from '../db/connect'
import Portfolio from '../models/Portfolio'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  try {
    await connectDB()
    const items = await Portfolio.find().sort({ createdAt: -1 })
    res.json(items)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.get('/featured', async (_req: Request, res: Response) => {
  try {
    await connectDB()
    const items = await Portfolio.find({ featured: true }).limit(3).sort({ createdAt: -1 })
    res.json(items)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
