import { Router, Response } from 'express'
import QRCode from 'qrcode'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { connectWhatsApp, logoutWhatsApp, getWaStatus, getWaQr, enqueueWaMessage } from '../../lib/baileys'
import WaMessageLog from './waMessageLog.model'

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
  connectWhatsApp().catch(() => {})
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

export default router
