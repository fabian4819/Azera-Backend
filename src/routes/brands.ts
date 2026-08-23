import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { connectDB } from '../db/connect'
import Brand from '../models/Brand'
import Campaign from '../modules/campaigns/campaign.model'
import { getDefaultTenant } from '../modules/tenants/defaultTenant'

const router = Router()

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${base}-${crypto.randomBytes(3).toString('hex')}`
}

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
    const brand = await Brand.create(brandData)

    if (campaignName) {
      const tenant = await getDefaultTenant()
      await Campaign.create({
        tenantId: tenant._id,
        brandId: brand._id,
        name: campaignName,
        objective: `${(brandData.tujuan || []).join(', ')}${brandData.deskripsi ? ' — ' + brandData.deskripsi : ''}`,
        budget: 0,
        criteria: { niches: [], provinces: [], platforms: platforms || [] },
        applySlug: slugify(campaignName),
        accessCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
      })
    }

    res.status(201).json({ success: true, id: brand._id })
  } catch (err) {
    res.status(400).json({ success: false, message: 'Failed to save inquiry' })
  }
})

export default router
