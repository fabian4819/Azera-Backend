import { Router, Request, Response } from 'express'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { upload, uploadDraft } from '../../middleware/upload'
import Campaign from './campaign.model'
import Application from '../applications/application.model'
import { buildPortalView } from './sheetView.service'
import { writeProgressCell, appendScreenshots, CellError, assertCreatorCanEditBase, setPostingLink, appendPostScreenshots, uploadDraftFiles } from './progress.service'

/**
 * Portal creator via magic link (/portal/:token), tanpa login. Token = Application.portalToken,
 * dibuat saat creator diterima. Creator lihat tabel campaign (kolom sesuai aturan akses admin)
 * dan cuma bisa edit sel kolom progress 'edit' di barisnya sendiri.
 */
const router = Router()

async function resolve(token: string) {
  const tenant = await getDefaultTenant()
  const application = await Application.findOne({ tenantId: tenant._id, portalToken: token, status: 'accepted' })
  const campaign = application && await Campaign.findOne({ tenantId: tenant._id, _id: application.campaignId }).populate('brandId', 'namaBrand')
  if (!application || !campaign) throw new CellError('Link tidak valid atau akses sudah dicabut', 404)
  return { tenant, application, campaign }
}

function sendError(res: Response, err: unknown) {
  if (err instanceof CellError) res.status(err.status).json({ message: err.message })
  else {
    console.error('Portal error:', err)
    res.status(500).json({ message: 'Server error' })
  }
}

router.get('/:token', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { tenant, application, campaign } = await resolve(req.params.token)
    const brand = campaign.brandId as unknown as { namaBrand?: string } | null
    res.json({
      campaign: {
        name: campaign.name,
        brandName: brand?.namaBrand ?? null,
        briefContent: campaign.briefContent || '',
        deliverables: campaign.deliverables,
        timeline: campaign.timeline,
        waGroupLink: campaign.waGroupLink || '',
      },
      ...(await buildPortalView(tenant._id, campaign, { role: 'creator', mine: application })),
    })
  } catch (err) {
    sendError(res, err)
  }
})

router.patch('/:token/cell', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { tenant, application, campaign } = await resolve(req.params.token)
    const columnId = String(req.body.columnId)
    const ctx = { tenantId: tenant._id, campaign, application, columnId, actor: 'creator' as const, userId: application.creatorId }
    if (columnId === 'base:post') {
      assertCreatorCanEditBase(campaign, columnId)
      await setPostingLink(ctx, req.body.value)
    } else await writeProgressCell(ctx, req.body.value)
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/:token/cell/upload', upload.array('files', 6), async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { tenant, application, campaign } = await resolve(req.params.token)
    const columnId = String(req.body.columnId)
    const ctx = { tenantId: tenant._id, campaign, application, columnId, actor: 'creator' as const, userId: application.creatorId }
    const files = (req.files as Express.Multer.File[]) || []
    if (columnId === 'base:insight') {
      assertCreatorCanEditBase(campaign, columnId)
      await appendPostScreenshots(ctx, files)
    } else await appendScreenshots(ctx, files)
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

// Draft foto/video: multer terpisah (80MB, image+video), beda dari upload screenshot (gambar 5MB)
router.post('/:token/draft/upload', uploadDraft.array('files', 10), async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { tenant, application, campaign } = await resolve(req.params.token)
    assertCreatorCanEditBase(campaign, 'base:draft')
    await uploadDraftFiles(
      { tenantId: tenant._id, campaign, application, actor: 'creator', userId: application.creatorId },
      (req.files as Express.Multer.File[]) || []
    )
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err)
  }
})

export default router
