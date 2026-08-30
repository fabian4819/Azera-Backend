import { Router, Request, Response } from 'express'
import { connectDB } from '../db/connect'
import { createBrandInquiry } from '../modules/brands/brand.service'

const router = Router()

/**
 * AD-11: Form Brand (landing page) → tulis ke Brand platform (sudah sejak awal,
 * model yang sama dipakai admin/campaign/invoice) DAN otomatis bikin draft
 * Campaign supaya lead langsung muncul di dashboard admin (Campaigns list),
 * bukan cuma tersimpan di collection Brand tanpa terlihat. Budget & timeline
 * di form landing masih berupa pilihan rentang/teks (bukan angka/tanggal
 * pasti) — Campaign dibuat sebagai draft budget 0, admin isi angka nyata
 * setelah follow-up dengan client.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { campaignName, platforms, ...brandData } = req.body
    const brand = await createBrandInquiry(brandData, campaignName, platforms)
    res.status(201).json({ success: true, id: brand._id })
  } catch (err) {
    res.status(400).json({ success: false, message: 'Failed to save inquiry' })
  }
})

export default router
