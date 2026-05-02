import { Router, Request, Response } from 'express'
import { connectDB } from '../lib/db'
import KOL from '../models/KOL'
import { upload } from '../middleware/upload'
import { uploadToCloudinary } from '../lib/cloudinary'

const router = Router()

router.post('/', upload.single('fotoProfil'), async (req: Request, res: Response) => {
  try {
    await connectDB()
    const data = { ...req.body }

    // Parse JSON fields sent as strings from multipart form
    if (typeof data.niche === 'string') data.niche = JSON.parse(data.niche)
    if (typeof data.instagram === 'string') data.instagram = JSON.parse(data.instagram)
    if (typeof data.tiktok === 'string') data.tiktok = JSON.parse(data.tiktok)
    if (typeof data.youtube === 'string') data.youtube = JSON.parse(data.youtube)

    if (req.file) {
      data.fotoProfil = await uploadToCloudinary(req.file.buffer, 'azera/kol-photos')
    }

    const kol = await KOL.create(data)
    res.status(201).json({ success: true, id: kol._id })
  } catch (err) {
    res.status(400).json({ success: false, message: 'Failed to save registration' })
  }
})

export default router
