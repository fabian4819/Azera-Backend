import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import Portfolio from '../../models/Portfolio'
import { requireAuth, AuthRequest } from '../../middleware/auth'
import { upload } from '../../middleware/upload'
import { uploadToCloudinary } from '../../lib/cloudinary'

const router = Router()
router.use(requireAuth)

// multer/busboy taruh field non-file multipart sebagai string flat di req.body —
// metrics & topCreators dikirim client sebagai JSON.stringify(...), perlu di-parse balik.
function parseJsonFields(data: Record<string, unknown>) {
  for (const field of ['metrics', 'topCreators']) {
    if (typeof data[field] === 'string' && data[field]) {
      try { data[field] = JSON.parse(data[field] as string) } catch { delete data[field] }
    }
  }
  return data
}

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const items = await Portfolio.find().sort({ createdAt: -1 })
    res.json(items)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.post('/', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'contents', maxCount: 3 }
]), async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const files = req.files as Record<string, Express.Multer.File[]>
    const data: Record<string, unknown> = parseJsonFields({ ...req.body })

    if (files?.logo?.[0]) {
      data.logo = await uploadToCloudinary(files.logo[0].buffer, 'azera/portfolio/logos')
    }
    if (files?.contents?.length) {
      data.contents = await Promise.all(
        files.contents.map(f => uploadToCloudinary(f.buffer, 'azera/portfolio/contents'))
      )
    }

    const item = await Portfolio.create(data)
    res.status(201).json(item)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.patch('/:id', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'contents', maxCount: 3 }
]), async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const files = req.files as Record<string, Express.Multer.File[]>
    const data: Record<string, unknown> = parseJsonFields({ ...req.body })

    if (files?.logo?.[0]) {
      data.logo = await uploadToCloudinary(files.logo[0].buffer, 'azera/portfolio/logos')
    }
    if (files?.contents?.length) {
      data.contents = await Promise.all(
        files.contents.map(f => uploadToCloudinary(f.buffer, 'azera/portfolio/contents'))
      )
    }

    const item = await Portfolio.findByIdAndUpdate(req.params.id, data, { new: true })
    if (!item) { res.status(404).json({ message: 'Not found' }); return }
    res.json(item)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    await Portfolio.findByIdAndDelete(req.params.id)
    res.json({ success: true })
  } catch { res.status(500).json({ message: 'Server error' }) }
})

export default router
