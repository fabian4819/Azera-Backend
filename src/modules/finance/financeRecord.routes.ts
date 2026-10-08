import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import FinanceRecord, { IFinanceRecord } from './financeRecord.model'
import Invoice from './invoice.model'
import Campaign from '../campaigns/campaign.model'
import Application from '../applications/application.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'finance'))

export function computeProfit(r: {
  revenue: number; feeCreator: number; feePic: number; feeMg: number
  reimburse: number; ads: number; opex: number
}): number {
  return r.revenue - r.feeCreator - r.feePic - r.feeMg - r.reimburse - r.ads - r.opex
}

async function computeRevenue(campaignId: string, tenantId: string): Promise<number> {
  const invoices = await Invoice.find({ tenantId, campaignId })
  return invoices.reduce((sum, inv) => sum + inv.total, 0)
}

const AUTO_FEES = [['feeCreator', 'creatorFee'], ['feePic', 'picFee'], ['feeMg', 'mgFee']] as const

/** Fee otomatis = fee per creator (tahap 1 buat campaign) x jumlah creator yang di-approve. */
async function computeAutoFees(campaignId: string, tenantId: string) {
  const [campaign, acceptedCount] = await Promise.all([
    Campaign.findOne({ _id: campaignId, tenantId }).select('fee'),
    Application.countDocuments({ tenantId, campaignId, status: 'accepted' }),
  ])
  const perCreator = { feeCreator: campaign?.fee?.creatorFee || 0, feePic: campaign?.fee?.picFee || 0, feeMg: campaign?.fee?.mgFee || 0 }
  const totals = Object.fromEntries(AUTO_FEES.map(([k]) => [k, perCreator[k] * acceptedCount])) as typeof perCreator
  return { acceptedCount, perCreator, totals }
}

/** Revenue (invoice) + fee otomatis untuk field yang tidak dioverride manual, lalu hitung ulang profit. */
async function syncRecord(record: IFinanceRecord, campaignId: string, tenantId: string) {
  const [revenue, auto] = await Promise.all([computeRevenue(campaignId, tenantId), computeAutoFees(campaignId, tenantId)])
  record.revenue = revenue
  for (const [k] of AUTO_FEES) if (!record.feeManual?.includes(k)) record[k] = auto.totals[k]
  record.profit = computeProfit(record)
  if (record.isModified()) await record.save()
  return { ...record.toJSON(), auto }
}

router.get('/campaigns/:campaignId/finance', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tenantId = req.auth!.tenantId as string
    const record = (await FinanceRecord.findOne({ tenantId, campaignId: req.params.campaignId }))
      ?? new FinanceRecord({ tenantId, campaignId: req.params.campaignId })
    res.json(await syncRecord(record, req.params.campaignId, tenantId))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

const EDITABLE_FEE_FIELDS = ['feeCreator', 'feePic', 'feeMg', 'reimburse', 'ads', 'opex', 'discount'] as const

router.patch('/campaigns/:campaignId/finance', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tenantId = req.auth!.tenantId as string
    const record = (await FinanceRecord.findOne({ tenantId, campaignId: req.params.campaignId }))
      ?? new FinanceRecord({ tenantId, campaignId: req.params.campaignId })
    for (const field of EDITABLE_FEE_FIELDS) {
      if (!(field in req.body)) continue
      const isAuto = AUTO_FEES.some(([k]) => k === field)
      // null untuk fee otomatis = kembali ke hitungan otomatis; angka = override manual
      if (isAuto && req.body[field] === null) {
        record.feeManual = record.feeManual.filter((k) => k !== field)
        continue
      }
      record[field] = Number(req.body[field]) || 0
      if (isAuto && !record.feeManual.includes(field as 'feeCreator')) record.feeManual.push(field as 'feeCreator')
    }
    res.json(await syncRecord(record, req.params.campaignId, tenantId))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
