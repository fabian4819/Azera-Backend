import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import Campaign from '../../modules/campaigns/campaign.model'
import Creator from '../../modules/creators/creator.model'
import Brand from '../../models/Brand'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tenantId = req.auth!.tenantId

    const [activeCampaigns, totalCreators, newBrandLeads, reviewedBrandLeads, contactedBrandLeads] = await Promise.all([
      Campaign.countDocuments({ tenantId, status: 'active' }),
      Creator.countDocuments({ tenantId }),
      Brand.countDocuments({ status: 'new' }),
      Brand.countDocuments({ status: 'reviewed' }),
      Brand.countDocuments({ status: 'contacted' }),
    ])

    // Grafik pendaftaran creator 30 hari terakhir
    const since = new Date()
    since.setDate(since.getDate() - 29)
    since.setHours(0, 0, 0, 0)
    const recentCreatorsForChart = await Creator.find({ tenantId, createdAt: { $gte: since } }, { createdAt: 1 })
    const dayCounts: Record<string, number> = {}
    for (let i = 0; i < 30; i++) {
      const d = new Date(since)
      d.setDate(d.getDate() + i)
      dayCounts[d.toISOString().slice(0, 10)] = 0
    }
    for (const c of recentCreatorsForChart) {
      const key = new Date(c.createdAt).toISOString().slice(0, 10)
      if (key in dayCounts) dayCounts[key]++
    }
    const dailyRegistrations = Object.entries(dayCounts).map(([date, count]) => ({ date, count }))

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

    res.json({
      activeCampaigns,
      totalCreators,
      newBrandLeads,
      brandPipeline: { new: newBrandLeads, reviewed: reviewedBrandLeads, contacted: contactedBrandLeads },
      dailyRegistrations,
      recentActivity,
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: (err as Error).message })
  }
})

export default router
