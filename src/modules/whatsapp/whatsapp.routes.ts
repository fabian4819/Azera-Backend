import { Router, Response, NextFunction } from 'express'
import QRCode from 'qrcode'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { connectWhatsApp, logoutWhatsApp, getWaStatus, getWaQr, enqueueWaMessage, sendManualReply, getDevLogs, devBotEnabled, DEV_BOT, WaBotKey, visibleBots } from '../../lib/baileys'
import { BOT_IDS, BotId } from './waTemplate.model'
import { resetBotEngagement } from './waChat.service'
import { clearLeadBotSession } from './leadBot.service'
import WaMessageLog from './waMessageLog.model'
import WaContact from './waContact.model'
import WaChatMessage from './waChatMessage.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

// Semua route WA berada di bawah /:bot (partnership | creator), dua koneksi Baileys terpisah.
// Daftar bot yang tampil di menu WhatsApp, bot developer cuma ada di backend lokal
router.get('/bots', (_req: AuthRequest, res: Response) => {
  res.json(visibleBots())
})

function resolveBot(req: AuthRequest, res: Response, next: NextFunction) {
  const bot = req.params.bot as WaBotKey
  if (!visibleBots().includes(bot)) {
    res.status(400).json({ message: `Bot tidak dikenal: ${req.params.bot}` })
    return
  }
  ;(req as AuthRequest & { bot: BotId }).bot = bot as BotId // developer cuma sampai ke route status/qr/connect/logout/test-send (lihat interceptor di bawah)
  next()
}
const bots = Router({ mergeParams: true })
bots.use(resolveBot)
router.use('/:bot', bots)

const botOf = (req: AuthRequest) => (req as AuthRequest & { bot: BotId }).bot

// AD-29: status koneksi Baileys (disconnected/connecting/qr/connected)
// Inbox (chat masuk & balasan) berisi percakapan pribadi, tidak dibuka untuk role developer
// Bot developer murni koneksi: tidak ada inbox, log cuma di memori proses lokal
bots.use((req: AuthRequest, res: Response, next) => {
  if (req.params.bot !== DEV_BOT) { next(); return }
  if (req.path === '/logs') { res.json(getDevLogs()); return }
  if (req.path.startsWith('/contacts')) { res.json([]); return }
  next()
})

bots.use('/contacts', (req: AuthRequest, res: Response, next) => {
  if (req.auth?.role === 'developer') { res.status(403).json({ message: 'Inbox WhatsApp tidak tersedia untuk role developer' }); return }
  next()
})

bots.get('/status', (req: AuthRequest, res: Response) => {
  res.json(getWaStatus(botOf(req)))
})

bots.get('/qr', async (req: AuthRequest, res: Response) => {
  const qr = getWaQr(botOf(req))
  if (!qr) { res.json({ qr: null }); return }
  if (req.query.format === 'terminal') {
    const ascii = await QRCode.toString(qr, { type: 'terminal', small: true })
    res.type('text/plain').send(ascii)
    return
  }
  const dataUrl = await QRCode.toDataURL(qr)
  res.json({ qr: dataUrl })
})

bots.post('/connect', async (req: AuthRequest, res: Response) => {
  if (devBotEnabled && req.params.bot !== DEV_BOT) {
    res.status(400).json({ message: 'Di backend lokal cuma Bot Developer yang bisa disambungkan (bot production hanya di server production).' })
    return
  }
  connectWhatsApp(botOf(req)).catch((err) => console.error('WA connect error:', err))
  res.json(getWaStatus(botOf(req)))
})

// Logout, hapus auth state supaya bisa pairing ulang (mis. ganti dari nomor testing ke nomor client)
bots.post('/logout', async (req: AuthRequest, res: Response) => {
  await logoutWhatsApp(botOf(req))
  res.json(getWaStatus(botOf(req)))
})

bots.get('/logs', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const logs = await WaMessageLog.find({ tenantId: req.auth!.tenantId, bot: botOf(req) }).sort({ createdAt: -1 }).limit(100)
    res.json(logs)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Kirim pesan uji manual, dipakai untuk verifikasi pairing (AD-29). `bot` override supaya benar-benar
// lewat koneksi bot yang dipilih (bukan diarahkan lewat audience trigger).
bots.post('/test-send', async (req: AuthRequest, res: Response) => {
  try {
    const { to, message } = req.body as { to?: string; message?: string }
    if (!to || !message) { res.status(400).json({ message: 'to dan message wajib diisi' }); return }
    await connectDB()
    const log = await enqueueWaMessage({
      tenantId: req.auth!.tenantId,
      trigger: 'broadcast_campaign',
      to,
      payload: message,
      bot: botOf(req),
    })
    res.status(201).json(log)
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim pesan', error: (err as Error).message })
  }
})

// ── Inbox (percakapan penuh, beda dari /logs yang cuma pesan trigger otomatis) ──

bots.get('/contacts', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const contacts = await WaContact.find({ tenantId: req.auth!.tenantId, bot: botOf(req) }).sort({ lastMessageAt: -1 })
    res.json(contacts)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

bots.get('/contacts/:jid/messages', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const messages = await WaChatMessage.find({ tenantId: req.auth!.tenantId, bot: botOf(req), jid: req.params.jid })
      .sort({ createdAt: 1 })
      .limit(500)
    res.json(messages)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

bots.post('/contacts/:jid/reply', async (req: AuthRequest, res: Response) => {
  try {
    const { text } = req.body as { text?: string }
    if (!text) { res.status(400).json({ message: 'text wajib diisi' }); return }
    await connectDB()
    await sendManualReply(botOf(req), req.params.jid, text)
    // Admin ambil alih chat manual, pause bot biar tidak nimpali balasan otomatis
    await WaContact.findOneAndUpdate(
      { tenantId: req.auth!.tenantId, bot: botOf(req), jid: req.params.jid },
      { $set: { botPaused: true } },
      { upsert: true }
    )
    res.status(201).json({ success: true })
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim balasan', error: (err as Error).message })
  }
})

bots.post('/contacts/:jid/read', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    await WaContact.findOneAndUpdate(
      { tenantId: req.auth!.tenantId, bot: botOf(req), jid: req.params.jid },
      { $set: { unreadCount: 0 } }
    )
    res.json({ success: true })
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

// Admin klik "Aktifkan lagi", nomor ini dianggap belum pernah dilayani bot (leadBot.service.ts
// hanya merespon chat pertama per nomor), sekaligus lepas bot-pause kalau admin sempat ambil alih manual.
bots.post('/contacts/:jid/reset-bot', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const contact = await resetBotEngagement(botOf(req), req.params.jid)
    clearLeadBotSession(botOf(req), req.params.jid) // sesi in-memory tidak punya TTL lagi, buang manual biar tidak nyangkut
    res.json(contact)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

bots.post('/contacts/:jid/bot-pause', async (req: AuthRequest, res: Response) => {
  try {
    const { paused } = req.body as { paused?: boolean }
    await connectDB()
    const contact = await WaContact.findOneAndUpdate(
      { tenantId: req.auth!.tenantId, bot: botOf(req), jid: req.params.jid },
      { $set: { botPaused: !!paused } },
      { new: true, upsert: true }
    )
    res.json(contact)
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
