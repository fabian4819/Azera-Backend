import { Router, Request, Response } from 'express'
import { connectDB } from '../../db/connect'
import { uploadProof } from '../../middleware/upload'
import { uploadToCloudinary } from '../../lib/cloudinary'
import Invoice from './invoice.model'

const router = Router()

// AD-25: halaman publik per-invoice (link + kode) — client cek status & bayar
router.get('/:id', async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { code } = req.query
    const invoice = await Invoice.findById(req.params.id).populate('campaignId', 'name')
    if (!invoice || invoice.accessCode !== code) {
      res.status(404).json({ message: 'Invoice tidak ditemukan' })
      return
    }
    res.json({
      number: invoice.number,
      campaign: invoice.campaignId,
      billTo: invoice.billTo,
      items: invoice.items,
      discount: invoice.discount,
      subtotal: invoice.subtotal,
      total: invoice.total,
      isDp: invoice.isDp,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      pdfUrl: invoice.pdfUrl,
    })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Client upload bukti transfer -> status waiting_verification (admin verifikasi manual, sesuai keputusan checklist)
router.post('/:id/payment-proof', uploadProof.single('proof'), async (req: Request, res: Response) => {
  try {
    await connectDB()
    const { code } = req.query
    const invoice = await Invoice.findById(req.params.id)
    if (!invoice || invoice.accessCode !== code) {
      res.status(404).json({ message: 'Invoice tidak ditemukan' })
      return
    }
    if (!req.file) { res.status(400).json({ message: 'File bukti transfer wajib diupload' }); return }

    const proofUrl = await uploadToCloudinary(req.file.buffer, `invoices/${invoice.campaignId}/proof`)
    invoice.paymentProofUrl = proofUrl
    invoice.status = 'waiting_verification'
    await invoice.save()

    res.json({ message: 'Bukti pembayaran terkirim, menunggu verifikasi admin.', status: invoice.status })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
