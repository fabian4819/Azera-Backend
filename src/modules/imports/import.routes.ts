import { Router, Response } from 'express'
import crypto from 'crypto'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { uploadSpreadsheet } from '../../middleware/upload'
import { parseImportFile, fetchPublicSheetCsv, ImportInputError, validateRow, exactName, checkSingleCampaign, ImportRow } from './import.service'
import Brand from '../../models/Brand'
import Campaign from '../campaigns/campaign.model'
import Creator from '../creators/creator.model'
import Submission from '../submissions/submission.model'
import Application from '../applications/application.model'
import FinanceRecord from '../finance/financeRecord.model'
import { computeProfit } from '../finance/financeRecord.routes'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${base}-${crypto.randomBytes(3).toString('hex')}`
}

// AD-28: upload spreadsheet, preview hasil parsing SEBELUM commit ke database
router.post('/preview', uploadSpreadsheet.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    // Sumber: file upload (multipart) ATAU link Google Sheets publik (JSON { url })
    const link = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
    if (!req.file && !link) { res.status(400).json({ message: 'Upload file atau isi link Google Sheets' }); return }
    const { rows, ignoredHeaders, sheetCount } = req.file
      ? await parseImportFile(req.file.buffer, req.file.originalname)
      : await parseImportFile(await fetchPublicSheetCsv(link), 'sheet.csv')
    const validCount = rows.filter((r) => r.errors.length === 0).length
    res.json({ rows, total: rows.length, validCount, ignoredHeaders, sheetCount })
  } catch (err) {
    if (err instanceof ImportInputError) { res.status(400).json({ message: err.message }); return }
    res.status(500).json({ message: 'Gagal membaca file', error: (err as Error).message })
  }
})

// AD-28: commit baris yang sudah direview (dan dikoreksi kalau perlu) dari frontend
router.post('/confirm', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { rows: bodyRows } = req.body as { rows: ImportRow[] }
    if (!bodyRows?.length) { res.status(400).json({ message: 'rows wajib diisi' }); return }
    const rows = checkSingleCampaign(bodyRows.map((r) => ({ ...r, errors: [...(r.errors ?? [])] })))

    const tenantId = req.auth!.tenantId
    let created = 0
    let updated = 0
    const skipped: { rowNumber: number; reason: string }[] = []
    // Fee per (campaign, creator): ambil nilai terbesar antar baris platform, supaya fee yang
    // ditulis ulang di tiap baris platform tidak terhitung dobel
    const fees = new Map<string, Map<string, { feeCreator: number; feePic: number; feeMg: number }>>()

    for (const row of rows) {
      const platform = String(row.platform ?? '').toLowerCase().trim()
      const errors = [...(row.errors ?? []), ...validateRow({ ...row, platform })]
      if (errors.length > 0) {
        skipped.push({ rowNumber: row.rowNumber, reason: [...new Set(errors)].join('; ') })
        continue
      }

      try {
        // Brand model legacy (landing page) belum multi-tenant — tidak ada tenantId untuk difilter
        let brand = await Brand.findOne({ namaBrand: exactName(row.brandName) })
        if (!brand) {
          brand = await Brand.create({
            namaBrand: row.brandName.trim(),
            namaPIC: '-', whatsapp: '-', email: '-', kategori: '-', paket: '-',
            targetAudience: '-', budget: '-', tujuan: [], durasi: '-',
            deskripsi: 'Data historis hasil import spreadsheet',
          })
        }

        let campaign = await Campaign.findOne({ tenantId, brandId: brand._id, name: exactName(row.campaignName) })
        if (!campaign) {
          campaign = await Campaign.create({
            tenantId, brandId: brand._id, name: row.campaignName.trim(),
            objective: 'Data historis hasil import spreadsheet',
            budget: 0,
            criteria: { niches: [], provinces: [], platforms: [] },
            status: 'completed', workflowStage: 'completed',
            applySlug: slugify(row.campaignName),
            accessCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
          })
        }

        let creator = await Creator.findOne({ tenantId, name: exactName(row.creatorName) })
        if (!creator) {
          creator = await Creator.create({
            tenantId, name: row.creatorName.trim(),
            phone: `import-${crypto.randomBytes(6).toString('hex')}`,
            niches: row.niche ? [row.niche] : [],
            source: 'import',
            status: 'approved',
          })
        }

        // Report/case study/AI insight membaca daftar creator dari Application accepted
        // (analytics.service.ts getCampaignCreatorSummaries) — tanpa ini tabel per-creator kosong
        await Application.updateOne(
          { tenantId, campaignId: campaign._id, creatorId: creator._id },
          { $setOnInsert: { status: 'accepted', curationResult: 'recommended', curationReason: 'Data historis hasil import spreadsheet', decidedAt: new Date() } },
          { upsert: true }
        )

        // Upsert, bukan create: import ulang file yang sama meng-update angka, bukan menggandakan views
        const result = await Submission.updateOne(
          { tenantId, campaignId: campaign._id, creatorId: creator._id, type: 'post', platform, link: row.link || null },
          {
            $set: {
              parsedInsight: {
                views: row.views, reach: row.reach, likes: row.likes,
                comments: row.comments, shares: row.shares, saves: row.saved,
              },
              postedAt: row.postedAt ? new Date(row.postedAt) : undefined,
              status: 'approved',
            },
          },
          { upsert: true }
        )
        if (result.upsertedCount) created++
        else updated++

        if (row.feeCreator !== undefined || row.feePic !== undefined || row.feeMg !== undefined) {
          const campaignKey = String(campaign._id)
          const byCreator = fees.get(campaignKey) ?? new Map()
          const prev = byCreator.get(String(creator._id)) ?? { feeCreator: 0, feePic: 0, feeMg: 0 }
          byCreator.set(String(creator._id), {
            feeCreator: Math.max(prev.feeCreator, row.feeCreator ?? 0),
            feePic: Math.max(prev.feePic, row.feePic ?? 0),
            feeMg: Math.max(prev.feeMg, row.feeMg ?? 0),
          })
          fees.set(campaignKey, byCreator)
        }
      } catch (err) {
        skipped.push({ rowNumber: row.rowNumber, reason: (err as Error).message })
      }
    }

    // Total fee = isi file ini (aturan klien: 1 file = 1 campaign, jadi file ini memuat seluruh creator-nya)
    for (const [campaignId, byCreator] of fees) {
      const list = [...byCreator.values()]
      const sum = (k: 'feeCreator' | 'feePic' | 'feeMg') => list.reduce((acc, f) => acc + f[k], 0)
      const avg = (k: 'feeCreator' | 'feePic' | 'feeMg') => Math.round(sum(k) / list.length)

      // Campaign.fee = fee PER creator (dipakai cost-per-view di analytics & AI insight) → rata-rata
      await Campaign.updateOne(
        { _id: campaignId, tenantId },
        { $set: { 'fee.creatorFee': avg('feeCreator'), 'fee.picFee': avg('feePic'), 'fee.mgFee': avg('feeMg') } }
      )

      // FinanceRecord = total seluruh creator. Revenue tetap dari invoice (dihitung ulang di GET finance)
      const record = (await FinanceRecord.findOne({ tenantId, campaignId })) ?? new FinanceRecord({ tenantId, campaignId })
      record.feeCreator = sum('feeCreator')
      record.feePic = sum('feePic')
      record.feeMg = sum('feeMg')
      record.profit = computeProfit(record)
      await record.save()
    }

    res.json({ created, updated, skipped })
  } catch (err) {
    res.status(500).json({ message: 'Gagal import data', error: (err as Error).message })
  }
})

export default router
