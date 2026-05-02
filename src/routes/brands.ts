import { Router, Request, Response } from 'express'
import { connectDB } from '../lib/db'
import Brand from '../models/Brand'

const router = Router()

router.post('/', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const brand = await Brand.create(req.body)
    res.status(201).json({ success: true, id: brand._id })
  } catch (err) {
    res.status(400).json({ success: false, message: 'Failed to save inquiry' })
  }
})

export default router
