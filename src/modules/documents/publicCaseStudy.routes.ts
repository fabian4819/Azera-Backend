import { Router, Request, Response } from 'express'
import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import DocumentModel from './document.model'

const router = Router()

/**
 * AD-10: Portfolio publik membaca case study hasil Auto Case Study Generator
 * (AD-27, model "content website") — bukan PDF, dirender sebagai halaman web
 * yang screenshot-friendly (client screenshot buat post IG, keputusan 16 Agu).
 */
router.get('/case-studies', async (_req: Request, res: Response) => {
  try {
    await connectDB()
    const tenant = await getDefaultTenant()
    const docs = await DocumentModel.find({ tenantId: tenant._id, type: 'case_study' }).sort({ createdAt: -1 })
    res.json(docs.map((d) => ({ id: d._id, ...d.data, createdAt: d.createdAt })))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.get('/case-studies/:id', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const tenant = await getDefaultTenant()
    const doc = await DocumentModel.findOne({ _id: req.params.id, tenantId: tenant._id, type: 'case_study' })
    if (!doc) { res.status(404).json({ message: 'Case study tidak ditemukan' }); return }
    res.json({ id: doc._id, ...doc.data, createdAt: doc.createdAt })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
