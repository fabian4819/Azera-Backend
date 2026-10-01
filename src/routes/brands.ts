import { Router, Request, Response } from 'express'
import { connectDB } from '../db/connect'
import { createBrandInquiry } from '../modules/brands/brand.service'

const router = Router()

/** Form Brand (landing page) → simpan Brand. Campaign dibuat manual oleh admin. */
router.post('/', async (req: Request, res: Response) => {
  try {
    await connectDB()
    // campaignName/platforms dari form tidak dipakai lagi (campaign dibuat manual)
    const { campaignName, platforms, ...brandData } = req.body
    const brand = await createBrandInquiry(brandData)
    res.status(201).json({ success: true, id: brand._id })
  } catch (err) {
    res.status(400).json({ success: false, message: 'Failed to save inquiry' })
  }
})

export default router
