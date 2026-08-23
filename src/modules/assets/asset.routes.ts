import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { uploadAsset } from '../../middleware/upload'
import { uploadToCloudinary } from '../../lib/cloudinary'
import Campaign from '../campaigns/campaign.model'
import Asset, { ASSET_CATEGORIES, AssetCategory } from './asset.model'
import { getAssetLibrary } from './asset.service'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'ce', 'finance'))

// AD-33: Asset Library gabungan (upload manual + auto dari brief/submission/document/invoice)
router.get('/campaigns/:campaignId/assets', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { search, category, tag } = req.query as { search?: string; category?: string; tag?: string }
    let items = await getAssetLibrary(req.params.campaignId, req.auth!.tenantId)
    if (category) items = items.filter((i) => i.category === category)
    if (tag) items = items.filter((i) => i.tags.includes(tag))
    if (search) {
      const q = search.toLowerCase()
      items = items.filter((i) =>
        i.label.toLowerCase().includes(q)
        || i.tags.some((t) => t.toLowerCase().includes(q))
        || i.content?.toLowerCase().includes(q)
      )
    }
    res.json(items)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.post('/campaigns/:campaignId/assets', uploadAsset.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return }
    if (!req.file) { res.status(400).json({ message: 'File wajib diupload' }); return }
    const { category, tags } = req.body as { category?: AssetCategory; tags?: string }
    if (!category || !ASSET_CATEGORIES.includes(category)) {
      res.status(400).json({ message: `category harus salah satu dari: ${ASSET_CATEGORIES.join(', ')}` })
      return
    }

    const fileUrl = await uploadToCloudinary(req.file.buffer, `assets/${campaign._id}/${category}`)
    const asset = await Asset.create({
      tenantId: req.auth!.tenantId,
      campaignId: campaign._id,
      brandId: campaign.brandId,
      category,
      fileName: req.file.originalname,
      fileUrl,
      tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      uploadedByUserId: req.auth!.userId,
    })
    res.status(201).json(asset)
  } catch (err) {
    res.status(500).json({ message: 'Gagal upload asset', error: (err as Error).message })
  }
})

router.delete('/assets/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const asset = await Asset.findOneAndDelete({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!asset) { res.status(404).json({ message: 'Not found' }); return }
    res.json({ deleted: true })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
