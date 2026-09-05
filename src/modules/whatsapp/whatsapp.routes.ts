import { Router, Response } from 'express'
import QRCode from 'qrcode'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { connectWhatsApp, logoutWhatsApp, getWaStatus, getWaQr, enqueueWaMessage, sendManualReply } from '../../lib/baileys'
import WaMessageLog from './waMessageLog.model'
import WaContact from './waContact.model'
import WaChatMessage from './waChatMessage.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

// AD-29: status koneksi Baileys (disconnected/connecting/qr/connected)
router.get('/status', (req: AuthRequest, res: Response) => {
  res.json(getWaStatus())
})

router.get('/qr', async (req: AuthRequest, res: Response) => {
  const qr = getWaQr()
  if (!qr) { res.json({ qr: null }); return }
  if (req.query.format === 'terminal') {
    const ascii = await QRCode.toString(qr, { type: 'terminal', small: true })
    res.type('text/plain').send(ascii)
    return
  }
  const dataUrl = await QRCode.toDataURL(qr)
  res.json({ qr: dataUrl })
})

router.post('/connect', async (req: AuthRequest, res: Response) => {
  connectWhatsApp().catch((err) => console.error('WA connect error:', err))
  res.json(getWaStatus())
})

// Logout — hapus auth state supaya bisa pairing ulang (mis. ganti dari nomor testing ke nomor client)
router.post('/logout', async (req: AuthRequest, res: Response) => {
  await logoutWhatsApp()
  res.json(getWaStatus())
})

router.get('/logs', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const logs = await WaMessageLog.find({ tenantId: req.auth!.tenantId }).sort({ createdAt: -1 }).limit(100)
    res.json(logs)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Kirim pesan uji manual — dipakai untuk verifikasi pairing (AD-29), juga berguna untuk broadcast ad-hoc (AD-31)
router.post('/test-send', async (req: AuthRequest, res: Response) => {
  try {
    const { to, message } = req.body as { to?: string; message?: string }
    if (!to || !message) { res.status(400).json({ message: 'to dan message wajib diisi' }); return }
    await connectDB()
    const log = await enqueueWaMessage({
      tenantId: req.auth!.tenantId,
      trigger: 'broadcast_campaign',
      to,
      payload: message,
    })
    res.status(201).json(log)
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim pesan', error: (err as Error).message })
  }
})

// ── Inbox (percakapan penuh, beda dari /logs yang cuma pesan trigger otomatis) ──

router.get('/contacts', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const contacts = await WaContact.find({ tenantId: req.auth!.tenantId }).sort({ lastMessageAt: -1 })
    res.json(contacts)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.get('/contacts/:jid/messages', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const messages = await WaChatMessage.find({ tenantId: req.auth!.tenantId, jid: req.params.jid })
      .sort({ createdAt: 1 })
      .limit(500)
    res.json(messages)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.post('/contacts/:jid/reply', async (req: AuthRequest, res: Response) => {
  try {
    const { text } = req.body as { text?: string }
    if (!text) { res.status(400).json({ message: 'text wajib diisi' }); return }
    await connectDB()
    await sendManualReply(req.params.jid, text)
    // Admin ambil alih chat manual — pause bot biar tidak nimpali balasan otomatis
    await WaContact.findOneAndUpdate(
      { tenantId: req.auth!.tenantId, jid: req.params.jid },
      { $set: { botPaused: true } },
      { upsert: true }
    )
    res.status(201).json({ success: true })
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim balasan', error: (err as Error).message })
  }
})

router.post('/contacts/:jid/read', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    await WaContact.findOneAndUpdate(
      { tenantId: req.auth!.tenantId, jid: req.params.jid },
      { $set: { unreadCount: 0 } }
    )
    res.json({ success: true })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

router.post('/contacts/:jid/bot-pause', async (req: AuthRequest, res: Response) => {
  try {
    const { paused } = req.body as { paused?: boolean }
    await connectDB()
    const contact = await WaContact.findOneAndUpdate(
      { tenantId: req.auth!.tenantId, jid: req.params.jid },
      { $set: { botPaused: !!paused } },
      { new: true, upsert: true }
    )
    res.json(contact)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
