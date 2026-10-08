import { Router, Request, Response } from 'express'
import { connectDB } from '../../db/connect'
import { renderHtmlToPdf } from '../../lib/pdf'
import { getDefaultTenant } from '../tenants/defaultTenant'
import DocumentModel from './document.model'
import { renderInvoice } from './docTemplates'

/**
 * Link preview invoice publik (?code=), pengganti link Google Drive di bot invoice WA
 * (invoiceBot.service.ts). Isi selalu dirender dari data terbaru, jadi edit di menu
 * Document langsung ikut. Dokumen tanpa accessCode (dibuat dari web) tidak bisa dibuka di sini.
 */
const router = Router()

async function findInvoice(req: Request) {
  await connectDB()
  const tenant = await getDefaultTenant()
  const doc = await DocumentModel.findOne({ _id: req.params.id, tenantId: tenant._id, type: 'invoice' })
  return doc?.accessCode && doc.accessCode === req.query.code ? doc : null
}

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const doc = await findInvoice(req)
    if (!doc) { res.status(404).send('Invoice tidak ditemukan'); return }
    const pdfHref = `${encodeURIComponent(String(doc._id))}/pdf?code=${encodeURIComponent(String(req.query.code))}`
    // Tampilan "kertas A4" di layar HP (viewport tetap, di-zoom out otomatis) + tombol unduh PDF
    const html = renderInvoice(doc.data).html
      .replace('<head>', '<head><meta name="viewport" content="width=840"><title>Invoice</title>')
      .replace('</style>', `html{background:#dcdce3}body{width:210mm;margin:16px auto;padding:12mm 18mm 16mm;background:#fff;box-shadow:0 2px 18px rgba(0,0,0,.18)}
        .dl{text-align:right;margin-bottom:10px;font:600 13px system-ui,sans-serif}.dl a{color:#4b2fc4}</style>`)
      .replace('<body>', `<body><div class="dl"><a href="${pdfHref}">⬇ Download PDF</a></div>`)
    res.type('html').send(html)
  } catch {
    res.status(500).send('Server error')
  }
})

router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const doc = await findInvoice(req)
    if (!doc) { res.status(404).send('Invoice tidak ditemukan'); return }
    const { html, pdf } = renderInvoice(doc.data)
    const buffer = await renderHtmlToPdf(html, pdf)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${String(doc.data.number || 'invoice').replace(/[^A-Za-z0-9-]+/g, '_')}.pdf"`)
    res.send(buffer)
  } catch {
    res.status(500).send('Gagal membuat PDF')
  }
})

export default router
