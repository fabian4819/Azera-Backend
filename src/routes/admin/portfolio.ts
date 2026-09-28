import { Router, Response } from 'express'
import mongoose from 'mongoose'
import { connectDB } from '../../db/connect'
import Portfolio, { PORTFOLIO_CATEGORIES } from '../../models/Portfolio'
import { requireAuth, AuthRequest } from '../../middleware/auth'
import { uploadMedia } from '../../middleware/upload'
import { uploadToCloudinary } from '../../lib/cloudinary'

const router = Router()
router.use(requireAuth)

// multer/busboy taruh field non-file multipart sebagai string flat di req.body —
// field bersarang dikirim client sebagai JSON.stringify(...), perlu di-parse balik.
function parseJsonFields(data: Record<string, unknown>) {
  for (const field of ['topCreators', 'platforms', 'scope', 'affiliate', 'niches']) {
    if (typeof data[field] === 'string' && data[field]) {
      try { data[field] = JSON.parse(data[field] as string) } catch { delete data[field] }
    }
  }
  return data
}

// Draft boleh belum lengkap; hanya status published yang wajib memenuhi field wajib revisi portofolio.
export function publishError(d: Record<string, any>): string | null {
  if (d.status !== 'published') return null
  for (const [k, label] of [['brand', 'Nama Brand'], ['title', 'Judul Campaign'], ['objective', 'Objective']]) {
    if (!String(d[k] ?? '').trim()) return `${label} wajib diisi sebelum publish`
  }
  if (!PORTFOLIO_CATEGORIES.includes(d.category)) return 'Kategori wajib dipilih sebelum publish'
  const rows = Array.isArray(d.platforms) ? d.platforms : []
  for (const r of rows) {
    if (!r.platform || (r.platform === 'other' && !String(r.platformName ?? '').trim())) return 'Nama platform wajib diisi'
    if (!Number.isFinite(r.creators) || !Number.isFinite(r.posts)) return 'Kreator aktif & postingan tayang wajib diisi per platform'
  }
  return null
}

function saveError(res: Response, e: unknown) {
  if (e instanceof mongoose.Error.ValidationError || e instanceof mongoose.Error.CastError) {
    res.status(400).json({ message: 'Data tidak valid: ' + e.message }); return
  }
  res.status(500).json({ message: 'Server error' })
}

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const items = await Portfolio.find().sort({ createdAt: -1 })
    res.json(items)
  } catch { res.status(500).json({ message: 'Server error' }) }
})

router.post('/', uploadMedia.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'contents', maxCount: 3 }
]), async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const files = req.files as Record<string, Express.Multer.File[]>
    const data: Record<string, unknown> = parseJsonFields({ ...req.body })
    const invalid = publishError(data)
    if (invalid) { res.status(400).json({ message: invalid }); return }

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
  } catch (e) { saveError(res, e) }
})

router.patch('/:id', uploadMedia.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'contents', maxCount: 3 }
]), async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const files = req.files as Record<string, Express.Multer.File[]>
    const data: Record<string, unknown> = parseJsonFields({ ...req.body })
    const invalid = publishError(data)
    if (invalid) { res.status(400).json({ message: invalid }); return }

    if (files?.logo?.[0]) {
      data.logo = await uploadToCloudinary(files.logo[0].buffer, 'azera/portfolio/logos')
    }
    if (files?.contents?.length) {
      data.contents = await Promise.all(
        files.contents.map(f => uploadToCloudinary(f.buffer, 'azera/portfolio/contents'))
      )
    }

    const item = await Portfolio.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true })
    if (!item) { res.status(404).json({ message: 'Not found' }); return }
    res.json(item)
  } catch (e) { saveError(res, e) }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    await Portfolio.findByIdAndDelete(req.params.id)
    res.json({ success: true })
  } catch { res.status(500).json({ message: 'Server error' }) }
})

export default router
