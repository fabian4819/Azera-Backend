import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'

import brandsRouter from './routes/brands'
import kolsRouter from './routes/kols'
import portfolioRouter from './routes/portfolio'
import adminAuthRouter from './routes/admin/auth'
import adminBrandsRouter from './routes/admin/brands'
import adminKOLsRouter from './routes/admin/kols'
import adminPortfolioRouter from './routes/admin/portfolio'

const app = express()

app.use(helmet())
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }))
app.use(express.json())

app.use('/api/brands', brandsRouter)
app.use('/api/kols', kolsRouter)
app.use('/api/portfolio', portfolioRouter)
app.use('/api/admin', adminAuthRouter)
app.use('/api/admin/brands', adminBrandsRouter)
app.use('/api/admin/kols', adminKOLsRouter)
app.use('/api/admin/portfolio', adminPortfolioRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))

export default app
