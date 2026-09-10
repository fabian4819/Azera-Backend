import dotenv from 'dotenv'
// .env.local (gitignored) lets you override just a few vars (e.g. MONGODB_URI) for
// local dev without touching .env — loaded first, so its values win; .env fills the rest.
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env } from './config/env'

import brandsRouter from './routes/brands'
import portfolioRouter from './routes/portfolio'
import { staffAuthRouter, creatorAuthRouter } from './modules/auth/auth.routes'
import adminBrandsRouter from './routes/admin/brands'
import adminPortfolioRouter from './routes/admin/portfolio'
import adminDashboardRouter from './routes/admin/dashboard'
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
import leadBotTemplateRouter from './modules/whatsapp/leadBotTemplate.routes'
import assetRouter from './modules/assets/asset.routes'
import publicCreatorRouter from './modules/creators/publicCreator.routes'
import publicCaseStudyRouter from './modules/documents/publicCaseStudy.routes'
import { picAuthRouter, picPortalRouter, picAdminRouter } from './modules/pic/pic.routes'
import extensionRouter from './modules/extension/extension.routes'
import extensionAdminRouter from './modules/extension/extensionAdmin.routes'
import { connectAllBots } from './lib/baileys'
import { backfillBotDiscriminator } from './modules/whatsapp/waChat.service'
import { startCronJobs } from './lib/cron'

const app = express()

app.use(helmet())

// Ekstensi KOL Lister memanggil dari origin `chrome-extension://<id>` (atau tanpa
// origin dari service worker). Route `/api/ext/*` di-auth pakai kode sambungan
// jangka panjang di header, bukan cookie — jadi CORS terbuka aman di sini
// (browser tidak auto-attach header itu, tidak ada risiko CSRF). Harus terdaftar
// SEBELUM cors global supaya preflight OPTIONS-nya tidak dijawab dengan origin ketat.
app.use(
  '/api/ext',
  cors({ origin: true, allowedHeaders: ['Content-Type', 'X-Azera-Ext-Token'] }),
  express.json(),
  extensionRouter
)

app.use(cors({ origin: env.clientOrigin }))
app.use(express.json())

// Landing page (publik) — belum dimigrasi ke modul platform, lihat docs/plan/modul-5-*
app.use('/api/brands', brandsRouter)
app.use('/api/portfolio', portfolioRouter)

// Auth — staff login (/api/admin/login) & creator login (/api/creator/login)
app.use('/api/admin', staffAuthRouter)
app.use('/api/creator', creatorAuthRouter)
app.use('/api/admin/brands', adminBrandsRouter)
app.use('/api/admin/portfolio', adminPortfolioRouter)
app.use('/api/admin/dashboard', adminDashboardRouter)

// Modul 2 — Modul Inti (AD-18..22)
app.use('/api/admin/campaigns', campaignRouter)
app.use('/api/admin/applications', applicationRouter)
app.use('/api/admin/creators', creatorRouter)
app.use('/api/campaigns', publicCampaignRouter)
app.use('/api/creator', talentPortalRouter)
app.use('/api/pic', picAuthRouter)
app.use('/api/pic', picPortalRouter)
app.use('/api/admin/pic', picAdminRouter)

// Modul 3 — Analitik & Finance (AD-23..28)
app.use('/api/admin', submissionRouter)
app.use('/api/admin', invoiceRouter)
app.use('/api/admin', financeRecordRouter)
app.use('/api/invoices', publicInvoiceRouter)
app.use('/api/admin/import', importRouter)

// Modul 4 — WhatsApp Automation (AD-29..31)
app.use('/api/admin/whatsapp', whatsappRouter)
app.use('/api/admin/wa-templates', waTemplateRouter)
app.use('/api/admin/lead-bot-templates', leadBotTemplateRouter)

// Modul 5 — Asset Library, Landing Page (AD-33..)
app.use('/api/admin', assetRouter)
app.use('/api/creators', publicCreatorRouter)
app.use('/api/portfolio', publicCaseStudyRouter)

// Ekstensi KOL Lister — admin: kelola kode sambungan, KOL Radar, capture intent
app.use('/api/admin/extension', extensionAdminRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.listen(env.port, () => console.log(`Server running on port ${env.port}`))

// Resume sesi Baileys tersimpan (kalau ada) saat server start untuk kedua bot (partnership + creator);
// kalau belum pernah pairing, otomatis masuk state 'qr' menunggu admin scan di halaman WhatsApp.
// Backfill dulu field `bot` di data WA lama (sekali, idempoten) sebelum koneksi & sinkron index.
backfillBotDiscriminator()
  .catch((err) => console.error('WA bot backfill error:', err))
  .finally(() => connectAllBots())

// AD-31: reminder pembayaran client (H-7/H-3/H-1/jatuh tempo) + daily progress report 17:00
startCronJobs()

export default app
