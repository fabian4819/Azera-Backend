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

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.listen(env.port, () => console.log(`Server running on port ${env.port}`))

export default app
