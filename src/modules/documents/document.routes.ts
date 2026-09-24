import { Router, Response } from 'express'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { renderHtmlToPdf } from '../../lib/pdf'
import { nextDocumentNumber } from '../finance/invoiceCounter.model'
import DocumentModel from './document.model'
import { RENDERERS, DocKind } from './docTemplates'

/**
 * AD-34/35/36: menu Document — Quotation, Invoice, SPK (klien) dari template Google Docs klien.
 * Form kosong (tidak terhubung ke campaign, keputusan 24 Sep 2026); PDF dirender saat diunduh.
 */
const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'finance'))

const KINDS = Object.keys(RENDERERS) as DocKind[]
const isKind = (v: unknown): v is DocKind => KINDS.includes(v as DocKind)
const MAX_DATA_BYTES = 100 * 1024

function validData(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === 'object' && !Array.isArray(data) && JSON.stringify(data).length <= MAX_DATA_BYTES
}

/** Judul baris di daftar dokumen — nama klien per jenis template */
function clientName(kind: DocKind, data: Record<string, unknown>): string {
  const pick = (o: unknown, k: string) => String((o as Record<string, unknown> | undefined)?.[k] ?? '')
  return kind === 'invoice' ? pick(data.billTo, 'name') : pick(data.client, 'company')
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const type = req.query.type
    if (!isKind(type)) { res.status(400).json({ message: 'type tidak valid' }); return }
    const docs = await DocumentModel.find({ tenantId: req.auth!.tenantId, type }).sort({ updatedAt: -1 }).limit(200)
    res.json(docs.map((d) => ({ _id: d._id, number: String(d.data.number ?? ''), client: clientName(type, d.data), updatedAt: d.updatedAt })))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { type, data } = req.body as { type: unknown; data: unknown }
    if (!isKind(type) || !validData(data)) { res.status(400).json({ message: 'type/data tidak valid' }); return }
    // Nomor kosong → otomatis dari counter; admin tetap bisa menimpa manual
    if (!String(data.number ?? '').trim()) data.number = await nextDocumentNumber(req.auth!.tenantId, type)
    const doc = await DocumentModel.create({ tenantId: req.auth!.tenantId, type, data })
    res.status(201).json(doc)
  } catch {
    res.status(500).json({ message: 'Gagal menyimpan dokumen' })
  }
})

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const doc = await DocumentModel.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId, type: { $in: KINDS } })
    if (!doc) { res.status(404).json({ message: 'Dokumen tidak ditemukan' }); return }
    res.json(doc)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const { data } = req.body as { data: unknown }
    if (!validData(data)) { res.status(400).json({ message: 'data tidak valid' }); return }
    const doc = await DocumentModel.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId, type: { $in: KINDS } })
    if (!doc) { res.status(404).json({ message: 'Dokumen tidak ditemukan' }); return }
    if (!String(data.number ?? '').trim()) data.number = doc.data.number
    doc.data = data
    doc.version += 1
    await doc.save()
    res.json(doc)
  } catch {
    res.status(500).json({ message: 'Gagal menyimpan dokumen' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const result = await DocumentModel.deleteOne({ _id: req.params.id, tenantId: req.auth!.tenantId, type: { $in: KINDS } })
    if (!result.deletedCount) { res.status(404).json({ message: 'Dokumen tidak ditemukan' }); return }
    res.json({ ok: true })
  } catch {
    res.status(500).json({ message: 'Gagal menghapus dokumen' })
  }
})

router.get('/:id/pdf', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const doc = await DocumentModel.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId, type: { $in: KINDS } })
    if (!doc || !isKind(doc.type)) { res.status(404).json({ message: 'Dokumen tidak ditemukan' }); return }
    const { html, pdf } = RENDERERS[doc.type](doc.data)
    const buffer = await renderHtmlToPdf(html, pdf)
    const filename = `${String(doc.data.number || doc.type).replace(/[^A-Za-z0-9-]+/g, '_')}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ message: 'Gagal membuat PDF', error: (err as Error).message })
  }
})

export default router
