import { Router, Response } from 'express'
import crypto from 'crypto'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { uploadToCloudinary } from '../../lib/cloudinary'
import { generateInvoicePdf } from '../../lib/invoicePdf'
import { nextInvoiceNumber } from './invoiceCounter.model'
import Invoice from './invoice.model'
import Campaign from '../campaigns/campaign.model'
import Brand from '../../models/Brand'
import WaMessageLog from '../whatsapp/waMessageLog.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin', 'finance'))

function formatDateID(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()
}

/**
 * AD-25: generate invoice — nomor & template PDF identik dengan bot-cashflow
 * (INV-AZK-YYYYMM-NNN), simpan PDF ke Cloudinary, catat pesan WA ringkasan
 * (status 'queued' — pengiriman sungguhan baru aktif setelah Baileys, modul 4).
 */
router.post('/campaigns/:campaignId/invoices', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, tenantId: req.auth!.tenantId })
    if (!campaign) { res.status(404).json({ message: 'Campaign not found' }); return }
    const brand = await Brand.findById(campaign.brandId)

    const { items, discount, isDp, dueDate } = req.body as {
      items: { name: string; description?: string; qty: number | null; rate: number }[]
      discount?: number
      isDp?: boolean
      dueDate?: string
    }
    if (!items?.length) { res.status(400).json({ message: 'items wajib diisi' }); return }

    const subtotal = items.reduce((sum, i) => sum + (i.qty ?? 1) * i.rate, 0)
    const discountAmount = Math.min(discount || 0, subtotal)
    const total = subtotal - discountAmount
    const issueDate = new Date()
    const due = dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const number = await nextInvoiceNumber(req.auth!.tenantId)

    const pdfBuffer = await generateInvoicePdf({
      invoiceNo: number,
      issueDate: formatDateID(issueDate),
      dueDate: formatDateID(due),
      billTo: brand?.namaBrand || 'Client',
      brandName: brand?.namaBrand,
      discount: discountAmount,
      items,
    })
    const pdfUrl = await uploadToCloudinary(pdfBuffer, `invoices/${campaign._id}`)

    const invoice = await Invoice.create({
      tenantId: req.auth!.tenantId,
      campaignId: campaign._id,
      brandId: campaign.brandId,
      number,
      accessCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
      billTo: brand?.namaBrand || 'Client',
      items, discount: discountAmount, subtotal, total,
      isDp: !!isDp,
      issueDate, dueDate: due,
      status: 'sent',
      pdfUrl,
    })

    await WaMessageLog.create({
      tenantId: req.auth!.tenantId,
      trigger: 'invoice_new',
      to: brand?.whatsapp || '-',
      payload: `✅ Invoice ${number}\n📋 ${campaign.name}\n👤 ${invoice.billTo}\n💰 Total: Rp${total.toLocaleString('id-ID')}\n📎 ${pdfUrl}`,
      status: 'queued',
      campaignId: campaign._id,
    })

    res.status(201).json(invoice)
  } catch (err) {
    res.status(500).json({ message: 'Gagal generate invoice', error: (err as Error).message })
  }
})

router.get('/campaigns/:campaignId/invoices', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const invoices = await Invoice.find({ tenantId: req.auth!.tenantId, campaignId: req.params.campaignId }).sort({ createdAt: -1 })
    res.json(invoices)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.get('/invoices/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const invoice = await Invoice.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
    if (!invoice) { res.status(404).json({ message: 'Not found' }); return }
    res.json(invoice)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Admin verifikasi bukti transfer -> status Paid
router.patch('/invoices/:id/verify', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const invoice = await Invoice.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.auth!.tenantId },
      { status: 'paid', verifiedByUserId: req.auth!.userId, verifiedAt: new Date() },
      { new: true }
    )
    if (!invoice) { res.status(404).json({ message: 'Not found' }); return }

    await WaMessageLog.create({
      tenantId: req.auth!.tenantId,
      trigger: 'payment_completed',
      to: '-',
      payload: `Pembayaran invoice ${invoice.number} telah diverifikasi.`,
      status: 'queued',
      campaignId: invoice.campaignId,
    })

    res.json(invoice)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
