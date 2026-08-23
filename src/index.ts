import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env } from './config/env'

import brandsRouter from './routes/brands'
import kolsRouter from './routes/kols'
import portfolioRouter from './routes/portfolio'
import { staffAuthRouter, creatorAuthRouter } from './modules/auth/auth.routes'
import adminBrandsRouter from './routes/admin/brands'
import adminKOLsRouter from './routes/admin/kols'
import adminPortfolioRouter from './routes/admin/portfolio'
import campaignRouter from './modules/campaigns/campaign.routes'
import publicCampaignRouter from './modules/campaigns/publicCampaign.routes'
import applicationRouter from './modules/applications/application.routes'
import creatorRouter from './modules/creators/creator.routes'
import talentPortalRouter from './modules/creators/talentPortal.routes'
import submissionRouter from './modules/submissions/submission.routes'
import invoiceRouter from './modules/finance/invoice.routes'
import financeRecordRouter from './modules/finance/financeRecord.routes'
import publicInvoiceRouter from './modules/finance/publicInvoice.routes'
import importRouter from './modules/imports/import.routes'
import whatsappRouter from './modules/whatsapp/whatsapp.routes'
import waTemplateRouter from './modules/whatsapp/waTemplate.routes'
import assetRouter from './modules/assets/asset.routes'
import publicCreatorRouter from './modules/creators/publicCreator.routes'
import publicCaseStudyRouter from './modules/documents/publicCaseStudy.routes'
import { connectWhatsApp } from './lib/baileys'
import { startCronJobs } from './lib/cron'

const app = express()

app.use(helmet())
app.use(cors({ origin: env.clientOrigin }))
app.use(express.json())

// Landing page (publik) — belum dimigrasi ke modul platform, lihat docs/plan/modul-5-*
app.use('/api/brands', brandsRouter)
app.use('/api/kols', kolsRouter)
app.use('/api/portfolio', portfolioRouter)

// Auth — staff login (/api/admin/login) & creator login (/api/creator/login)
app.use('/api/admin', staffAuthRouter)
app.use('/api/creator', creatorAuthRouter)
app.use('/api/admin/brands', adminBrandsRouter)
app.use('/api/admin/kols', adminKOLsRouter)
app.use('/api/admin/portfolio', adminPortfolioRouter)

// Modul 2 — Modul Inti (AD-18..22)
app.use('/api/admin/campaigns', campaignRouter)
app.use('/api/admin/applications', applicationRouter)
app.use('/api/admin/creators', creatorRouter)
app.use('/api/campaigns', publicCampaignRouter)
app.use('/api/creator', talentPortalRouter)

// Modul 3 — Analitik & Finance (AD-23..28)
app.use('/api/admin', submissionRouter)
app.use('/api/admin', invoiceRouter)
app.use('/api/admin', financeRecordRouter)
app.use('/api/invoices', publicInvoiceRouter)
app.use('/api/admin/import', importRouter)

// Modul 4 — WhatsApp Automation (AD-29..31)
app.use('/api/admin/whatsapp', whatsappRouter)
app.use('/api/admin/wa-templates', waTemplateRouter)

// Modul 5 — Asset Library, Landing Page (AD-33..)
app.use('/api/admin', assetRouter)
app.use('/api/creators', publicCreatorRouter)
app.use('/api/portfolio', publicCaseStudyRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.listen(env.port, () => console.log(`Server running on port ${env.port}`))

// Resume sesi Baileys tersimpan (kalau ada) saat server start; kalau belum pernah pairing,
// otomatis masuk state 'qr' menunggu admin scan di halaman WhatsApp.
connectWhatsApp().catch((err) => console.error('Baileys connect error:', err))

// AD-31: reminder pembayaran client (H-7/H-3/H-1/jatuh tempo) + daily progress report 17:00
startCronJobs()

export default app
