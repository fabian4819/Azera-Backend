import { Router, Response } from 'express'
import crypto from 'crypto'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { uploadSpreadsheet } from '../../middleware/upload'
import { parseImportFile, ImportRow } from './import.service'
import Brand from '../../models/Brand'
import Campaign from '../campaigns/campaign.model'
import Creator from '../creators/creator.model'
import Submission from '../submissions/submission.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${base}-${crypto.randomBytes(3).toString('hex')}`
}

// AD-28: upload spreadsheet, preview hasil parsing SEBELUM commit ke database
router.post('/preview', uploadSpreadsheet.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ message: 'File wajib diupload' }); return }
    const rows = await parseImportFile(req.file.buffer, req.file.originalname)
    const validCount = rows.filter((r) => r.errors.length === 0).length
    res.json({ rows, total: rows.length, validCount })
  } catch (err) {
    res.status(500).json({ message: 'Gagal membaca file', error: (err as Error).message })
  }
})

// AD-28: commit baris yang sudah direview (dan dikoreksi kalau perlu) dari frontend
router.post('/confirm', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { rows } = req.body as { rows: ImportRow[] }
    if (!rows?.length) { res.status(400).json({ message: 'rows wajib diisi' }); return }

    const tenantId = req.auth!.tenantId
    let created = 0
    const skipped: { rowNumber: number; reason: string }[] = []

    for (const row of rows) {
      if (row.errors.length > 0) {
        skipped.push({ rowNumber: row.rowNumber, reason: row.errors.join('; ') })
        continue
      }

      let brand = await Brand.findOne({ namaBrand: new RegExp(`^${row.brandName}$`, 'i') })
      if (!brand) {
        brand = await Brand.create({
          namaBrand: row.brandName,
          namaPIC: '-', whatsapp: '-', email: '-', kategori: '-', paket: '-',
          targetAudience: '-', budget: '-', tujuan: [], durasi: '-',
          deskripsi: 'Data historis hasil import spreadsheet',
        })
      }

      let campaign = await Campaign.findOne({ tenantId, brandId: brand._id, name: new RegExp(`^${row.campaignName}$`, 'i') })
      if (!campaign) {
        campaign = await Campaign.create({
          tenantId, brandId: brand._id, name: row.campaignName,
          objective: 'Data historis hasil import spreadsheet',
          budget: 0,
          criteria: { niches: [], provinces: [], platforms: [] },
          status: 'completed', workflowStage: 'completed',
          applySlug: slugify(row.campaignName),
          accessCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
        })
      }

      let creator = await Creator.findOne({ tenantId, name: new RegExp(`^${row.creatorName}$`, 'i') })
      if (!creator) {
        creator = await Creator.create({
          tenantId, name: row.creatorName,
          phone: `import-${crypto.randomBytes(6).toString('hex')}`,
          niches: row.niche ? [row.niche] : [],
          source: 'import',
          status: 'approved',
        })
      }

      await Submission.create({
        tenantId, campaignId: campaign._id, creatorId: creator._id,
        type: 'post', platform: row.platform, link: row.link,
        parsedInsight: {
          views: row.views, reach: row.reach, likes: row.likes,
          comments: row.comments, shares: row.shares, saves: row.saved,
        },
        status: 'approved',
      })
      created++
    }

    res.json({ created, skipped })
  } catch (err) {
    res.status(500).json({ message: 'Gagal import data', error: (err as Error).message })
  }
})

export default router
