import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import FinanceRecord from './financeRecord.model'
import Invoice from './invoice.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'finance'))

function computeProfit(r: {
  revenue: number; feeCreator: number; feePic: number; feeMg: number
  reimburse: number; ads: number; opex: number
}): number {
  return r.revenue - r.feeCreator - r.feePic - r.feeMg - r.reimburse - r.ads - r.opex
}

async function computeRevenue(campaignId: string, tenantId: string): Promise<number> {
  const invoices = await Invoice.find({ tenantId, campaignId })
  return invoices.reduce((sum, inv) => sum + inv.total, 0)
}

router.get('/campaigns/:campaignId/finance', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    let record = await FinanceRecord.findOne({ tenantId: req.auth!.tenantId, campaignId: req.params.campaignId })
    const revenue = await computeRevenue(req.params.campaignId, req.auth!.tenantId as string)
    if (!record) {
      record = await FinanceRecord.create({ tenantId: req.auth!.tenantId, campaignId: req.params.campaignId, revenue, profit: revenue })
    } else if (record.revenue !== revenue) {
      record.revenue = revenue
      record.profit = computeProfit(record)
      await record.save()
    }
    res.json(record)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

const EDITABLE_FEE_FIELDS = ['feeCreator', 'feePic', 'feeMg', 'reimburse', 'ads', 'opex', 'discount'] as const

router.patch('/campaigns/:campaignId/finance', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const revenue = await computeRevenue(req.params.campaignId, req.auth!.tenantId as string)
    let record = await FinanceRecord.findOne({ tenantId: req.auth!.tenantId, campaignId: req.params.campaignId })
    if (!record) {
      record = new FinanceRecord({ tenantId: req.auth!.tenantId, campaignId: req.params.campaignId })
    }
    for (const field of EDITABLE_FEE_FIELDS) {
      if (field in req.body) record[field] = req.body[field]
    }
    record.revenue = revenue
    record.profit = computeProfit(record)
    await record.save()
    res.json(record)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
