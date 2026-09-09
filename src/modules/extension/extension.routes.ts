import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import Tenant from '../tenants/tenant.model'
import User from '../users/user.model'
import Campaign from '../campaigns/campaign.model'
import Submission from '../submissions/submission.model'
import { tryAutoTransition } from '../campaigns/workflow.service'
import { requireExtensionToken, ExtRequest } from './extension.middleware'
import CaptureIntent from './captureIntent.model'
import SocialSnapshot from './socialSnapshot.model'
import { ingestSnapshot, findSubmissionsByPostUrl, normalizePostUrl, AkunInput } from './extension.service'

const router = Router()
router.use(requireExtensionToken)

async function activeCampaignNames(tenantId: string): Promise<string[]> {
  const rows = await Campaign.find({ tenantId, status: { $in: ['draft', 'active'] } })
    .select('name').sort({ createdAt: -1 }).limit(100)
  return rows.map((c) => c.name).filter(Boolean)
}

/** cek koneksi — dipanggil popup ekstensi saat kode ditempel */
router.get('/ping', async (req: ExtRequest, res: Response) => {
  try {
    await connectDB()
    const [tenant, user, campaign, kol] = await Promise.all([
      Tenant.findById(req.ext!.tenantId),
      User.findById(req.ext!.userId),
      activeCampaignNames(req.ext!.tenantId),
      SocialSnapshot.distinct('username', { tenantId: req.ext!.tenantId }),
    ])
    res.json({
      ok: true,
      tenant: tenant ? { name: tenant.name, slug: tenant.slug } : null,
      user: user ? { name: user.name, email: user.email } : null,
      campaign,
      kol: kol.length,
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/**
 * Alur listing: kirim satu baris akun KOL. Body sama seperti KOL Lister:
 *   { mode:'kol', akun:{...snapshotRow}, campaign?, category? }
 */
router.post('/snapshots', async (req: ExtRequest, res: Response) => {
  try {
    await connectDB()
    const akun: AkunInput = req.body.akun || req.body
    if (!akun || !akun.platform || !akun.username) {
      res.status(400).json({ message: 'Data akun belum lengkap' })
      return
    }
    const campaign = String(req.body.campaign || '').trim()
    const r = await ingestSnapshot(req.ext!.tenantId, req.ext!.userId, akun, { shortlistCampaign: campaign })
    res.status(201).json({
      ok: true,
      mode: 'kol',
      baru: r.isFirstSnapshot,
      campaignTarget: campaign || null,
      campaign: await activeCampaignNames(req.ext!.tenantId),
      matchedCreator: r.matchedCreator,
      isNewProspect: r.isNewProspect,
    })
  } catch (err) {
    res.status(400).json({ ok: false, message: (err as Error).message, error: (err as Error).message })
  }
})

/**
 * Alur post: kirim insight satu post yang sedang dibuka. Body:
 *   { mode:'post', post:{ url, likes, comments, views, shares, ... }, campaign, biaya? }
 * Dicocokkan ke Submission lewat link. reach & saves tetap diisi admin manual.
 */
router.post('/post-insight', async (req: ExtRequest, res: Response) => {
  try {
    await connectDB()
    const post = req.body.post || req.body
    const postUrl = post.url || post.postUrl || req.body.postUrl
    if (!postUrl) { res.status(400).json({ ok: false, error: 'Link post wajib' }); return }

    const metrics = {
      views: num(post.views), likes: num(post.likes),
      comments: num(post.comments), shares: num(post.shares),
    }

    let matches = await findSubmissionsByPostUrl(req.ext!.tenantId, postUrl)
    if (req.body.submissionId) {
      matches = matches.filter((s) => String(s._id) === String(req.body.submissionId))
    }

    if (matches.length === 0) {
      res.status(404).json({
        ok: false,
        error: 'Tidak ada submission dengan link post ini di AzeraKOL. Pastikan creator sudah submit link-nya.',
        normalizedUrl: normalizePostUrl(postUrl),
      })
      return
    }
    if (matches.length > 1 && !req.body.submissionId) {
      res.status(409).json({
        ok: false,
        error: `${matches.length} submission cocok dengan link ini — buka di Campaign Analytics untuk pilih.`,
        candidates: matches.map((c) => ({ _id: c._id, creator: c.creatorId, campaign: c.campaignId })),
      })
      return
    }

    const sub = matches[0]
    applyMetrics(sub, metrics, req.ext!.userId)
    if (!sub.link) sub.link = postUrl
    await sub.save()
    await tryAutoTransition({
      campaignId: String(sub.campaignId), tenantId: req.ext!.tenantId,
      fromStage: 'waiting_insight', toStage: 'insight_collected', userId: req.ext!.userId,
    })

    const campaignName = (sub.campaignId as unknown as { name?: string })?.name
    res.json({ ok: true, mode: 'post', baru: false, campaign: campaignName || '—' })
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message })
  }
})

/** alur redirect-dari-web: ekstensi baca #azk=<id>, tanya intent-nya apa */
router.get('/capture-intents/:id', async (req: ExtRequest, res: Response) => {
  try {
    await connectDB()
    const intent = await CaptureIntent.findOne({ _id: req.params.id, tenantId: req.ext!.tenantId })
      .populate('creatorId', 'name')
      .populate('campaignId', 'name')
    if (!intent) { res.status(404).json({ message: 'Intent tidak ditemukan' }); return }
    if (intent.status !== 'pending' || intent.expiresAt < new Date()) {
      res.status(410).json({ message: 'Intent sudah dipakai atau kadaluarsa', status: intent.status })
      return
    }
    res.json({
      _id: intent._id,
      type: intent.type,
      platform: intent.platform,
      handle: intent.handle,
      label: intent.label,
      creator: intent.creatorId,
      campaign: intent.campaignId,
      submissionId: intent.submissionId,
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/** fulfill intent — hasil scrape nempel ke creator/submission target tanpa staf pilih manual */
router.post('/capture-intents/:id/fulfill', async (req: ExtRequest, res: Response) => {
  try {
    await connectDB()
    const intent = await CaptureIntent.findOne({ _id: req.params.id, tenantId: req.ext!.tenantId })
    if (!intent) { res.status(404).json({ message: 'Intent tidak ditemukan' }); return }
    if (intent.status !== 'pending') { res.status(410).json({ message: 'Intent sudah dipakai' }); return }

    if (intent.type === 'profile') {
      const akun: AkunInput = req.body.akun || req.body
      const { snapshot } = await ingestSnapshot(
        req.ext!.tenantId, req.ext!.userId,
        { ...akun, platform: intent.platform, username: akun.username || intent.handle || '' },
        { captureIntentId: String(intent._id), forceCreatorId: intent.creatorId ? String(intent.creatorId) : undefined }
      )
      intent.resultSnapshotId = snapshot._id as never
    } else {
      const post = req.body.post || req.body
      const sub = intent.submissionId
        ? await Submission.findOne({ _id: intent.submissionId, tenantId: req.ext!.tenantId })
        : null
      if (!sub) { res.status(404).json({ message: 'Submission target tidak ada' }); return }
      applyMetrics(sub, {
        views: num(post.views), likes: num(post.likes),
        comments: num(post.comments), shares: num(post.shares),
      }, req.ext!.userId)
      if (!sub.link && (post.url || post.postUrl)) sub.link = post.url || post.postUrl
      await sub.save()
      await tryAutoTransition({
        campaignId: String(sub.campaignId), tenantId: req.ext!.tenantId,
        fromStage: 'waiting_insight', toStage: 'insight_collected', userId: req.ext!.userId,
      })
    }

    intent.status = 'fulfilled'
    intent.fulfilledAt = new Date()
    await intent.save()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ message: (err as Error).message })
  }
})

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function applyMetrics(
  sub: InstanceType<typeof Submission>,
  m: { views?: number; likes?: number; comments?: number; shares?: number },
  userId: string
) {
  const current = sub.parsedInsight || {}
  if (m.views !== undefined) current.views = m.views
  if (m.likes !== undefined) current.likes = m.likes
  if (m.comments !== undefined) current.comments = m.comments
  if (m.shares !== undefined) current.shares = m.shares
  // reach & saves tidak bisa di-scrape dari luar akun — biarkan admin isi manual
  current.verifiedByUserId = userId as never
  current.verifiedAt = new Date()
  sub.parsedInsight = current
}

export default router
