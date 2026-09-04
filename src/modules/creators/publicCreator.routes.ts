import { Router, Request, Response } from 'express'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import Creator from './creator.model'

const router = Router()

/**
 * AD-12: Form Creator (landing page) → tulis ke Creator (Creator Performance DB),
 * bukan collection KOL lama. Sama seperti publicCampaign.routes.ts `/apply`:
 * duplikat by nomor WA di-link ke profile existing, bukan bikin baru/overwrite.
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const tenant = await getDefaultTenant()
    const {
      name, phone, gender, domicile, socials, activities, niches, nicheOther,
      contentStyles, contentStyleOther, bankAccount, npwp,
      rateEstimateType, rateEstimateAmount, rateNegotiable, mediaKitUrl, portfolioLink,
    } = req.body

    if (!name || !phone || !gender) {
      res.status(400).json({ message: 'Nama, nomor WA, dan jenis kelamin wajib diisi' })
      return
    }

    let creator = await Creator.findOne({ tenantId: tenant._id, phone })
    if (creator) {
      res.status(200).json({ message: 'Kamu sudah pernah mendaftar sebelumnya. Tim kami akan segera menghubungi.', id: creator._id, alreadyExists: true })
      return
    }

    creator = await Creator.create({
      tenantId: tenant._id,
      name, phone, gender, domicile,
      socials: socials || [],
      activities: activities || [],
      niches: niches || [],
      nicheOther,
      contentStyles: contentStyles || [],
      contentStyleOther,
      bankAccount, npwp,
      rateEstimateType, rateEstimateAmount, rateNegotiable, mediaKitUrl, portfolioLink,
      source: 'form',
    })

    res.status(201).json({ message: 'Pendaftaran berhasil! Tim AzeraKOL akan review profil kamu.', id: creator._id })
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: (err as Error).message })
  }
})

export default router
