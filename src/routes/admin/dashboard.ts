import { Router, Response } from 'express'
import { Types } from 'mongoose'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Campaign, { WORKFLOW_STAGES } from '../../modules/campaigns/campaign.model'
import Creator from '../../modules/creators/creator.model'
import Brand from '../../models/Brand'
import Invoice from '../../modules/finance/invoice.model'
import FinanceRecord from '../../modules/finance/financeRecord.model'
import PicUser from '../../modules/pic/pic.model'
import { getTopCreatorsByEngagement } from '../../modules/creators/performanceScore.service'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tenantId = req.auth!.tenantId

    const [activeCampaigns, totalCampaigns, totalCreators, newBrandLeads, reviewedBrandLeads, contactedBrandLeads] = await Promise.all([
      Campaign.countDocuments({ tenantId, status: 'active' }),
      Campaign.countDocuments({ tenantId }),
      Creator.countDocuments({ tenantId }),
      Brand.countDocuments({ status: 'new' }),
      Brand.countDocuments({ status: 'reviewed' }),
      Brand.countDocuments({ status: 'contacted' }),
    ])

    // Grafik campaign baru 30 hari terakhir
    const since = new Date()
    since.setDate(since.getDate() - 29)
    since.setHours(0, 0, 0, 0)
    const recentCampaignsForChart = await Campaign.find({ tenantId, createdAt: { $gte: since } }, { createdAt: 1 })
    const dayCounts: Record<string, number> = {}
    for (let i = 0; i < 30; i++) {
      const d = new Date(since)
      d.setDate(d.getDate() + i)
      dayCounts[d.toISOString().slice(0, 10)] = 0
    }
    for (const c of recentCampaignsForChart) {
      const key = new Date(c.createdAt).toISOString().slice(0, 10)
      if (key in dayCounts) dayCounts[key]++
    }
    const dailyCampaigns = Object.entries(dayCounts).map(([date, count]) => ({ date, count }))

    const [recentBrands, recentCreators] = await Promise.all([
      Brand.find().sort({ createdAt: -1 }).limit(5).select('namaBrand namaPIC createdAt status'),
      Creator.find({ tenantId }).sort({ createdAt: -1 }).limit(5).select('name createdAt status'),
    ])
    const recentActivity = [
      ...recentBrands.map((b) => ({
        type: 'brand' as const, id: String(b._id), name: b.namaBrand,
        subtitle: `PIC: ${b.namaPIC}`, status: b.status, createdAt: b.createdAt,
      })),
      ...recentCreators.map((c) => ({
        type: 'creator' as const, id: String(c._id), name: c.name,
        subtitle: 'Pendaftaran KOL/Creator', status: c.status, createdAt: c.createdAt,
      })),
    ]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 8)

    // AD-37 Dashboard Owner: funnel, pembayaran tertunda, action items, revenue/bulan, top creator
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
    sixMonthsAgo.setDate(1)
    sixMonthsAgo.setHours(0, 0, 0, 0)

    const [
      workflowCounts, unpaidInvoices, overdueInvoiceCount,
      pendingCreatorPaymentCount, topCreators, feeRecordsForChart, allFeeRecords,
    ] = await Promise.all([
      Campaign.aggregate([
        { $match: { tenantId: new Types.ObjectId(tenantId), status: { $ne: 'cancelled' } } },
        { $group: { _id: '$workflowStage', count: { $sum: 1 } } },
      ]),
      Invoice.find({ tenantId, status: { $ne: 'paid' } }, { total: 1 }),
      Invoice.countDocuments({ tenantId, status: { $in: ['sent', 'waiting_verification'] }, dueDate: { $lt: new Date() } }),
      PicUser.countDocuments({ tenantId, 'paymentInfo.methodName': { $exists: false } }),
      getTopCreatorsByEngagement(tenantId),
      FinanceRecord.find({ tenantId, updatedAt: { $gte: sixMonthsAgo } }, { feeCreator: 1, feePic: 1, feeMg: 1, updatedAt: 1 }),
      FinanceRecord.find({ tenantId }, { feeCreator: 1, feePic: 1, feeMg: 1 }),
    ])

    const totalDistributedFees = allFeeRecords.reduce((sum, r) => sum + r.feeCreator + r.feePic + r.feeMg, 0)

    const workflowFunnel = WORKFLOW_STAGES.map((stage) => ({
      stage,
      count: (workflowCounts.find((w) => w._id === stage) as { count: number } | undefined)?.count || 0,
    }))

    const pendingPayments = {
      client: { count: unpaidInvoices.length, total: unpaidInvoices.reduce((sum, inv) => sum + inv.total, 0) },
      creator: { count: pendingCreatorPaymentCount },
    }

    const actionItems = [
      ...(newBrandLeads > 0 ? [{ label: 'Lead brand baru belum ditindaklanjuti', count: newBrandLeads, to: '/admin/brands' }] : []),
      ...(overdueInvoiceCount > 0 ? [{ label: 'Invoice jatuh tempo belum dibayar', count: overdueInvoiceCount, to: '/admin/documents/invoice' }] : []),
      ...(pendingCreatorPaymentCount > 0 ? [{ label: 'PIC belum konfirmasi info pembayaran', count: pendingCreatorPaymentCount, to: '/admin/campaigns' }] : []),
    ]

    const monthBuckets: Record<string, number> = {}
    for (let i = 0; i < 6; i++) {
      const d = new Date(sixMonthsAgo)
      d.setMonth(d.getMonth() + i)
      monthBuckets[d.toISOString().slice(0, 7)] = 0
    }
    for (const r of feeRecordsForChart) {
      const key = new Date(r.updatedAt).toISOString().slice(0, 7)
      if (key in monthBuckets) monthBuckets[key] += r.feeCreator + r.feePic + r.feeMg
    }
    const monthlyDistributedFees = Object.entries(monthBuckets).map(([month, total]) => ({ month, total }))

    res.json({
      activeCampaigns,
      totalCampaigns,
      totalDistributedFees,
      totalCreators,
      newBrandLeads,
      brandPipeline: { new: newBrandLeads, reviewed: reviewedBrandLeads, contacted: contactedBrandLeads },
      dailyCampaigns,
      recentActivity,
      workflowFunnel,
      pendingPayments,
      actionItems,
      monthlyDistributedFees,
      topCreators,
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: (err as Error).message })
  }
})

export default router
