import { Router, Response, NextFunction } from 'express'
import QRCode from 'qrcode'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest, effectiveRole } from '../../middleware/auth'
import { connectWhatsApp, logoutWhatsApp, getWaStatus, getWaQr, devBotEnabled, adminBotId, AdminSlot, AZERA_SENDER } from '../../lib/baileys'
import User from '../users/user.model'

/**
 * Menu WhatsApp Admin: tiap admin menyambungkan 2 nomor WA sendiri (utama & backup) yang bisa dipilih
 * sebagai pengirim pesan bot per campaign. Admin cuma bisa mengatur nomornya sendiri, owner semua.
 * Sesi ini kirim saja (chat pribadi admin tidak dibaca), lihat AdminBotId di lib/baileys.ts.
 */
const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

const SLOTS: AdminSlot[] = ['primary', 'backup']
const SLOT_LABEL: Record<AdminSlot, string> = { primary: 'Utama', backup: 'Backup' }
const isOwner = (req: AuthRequest) => effectiveRole(req.auth!.role) === 'owner'

/** Admin yang tampil: owner lihat semua admin & owner, admin cuma dirinya sendiri */
async function visibleAdmins(req: AuthRequest) {
  await connectDB()
  const filter = isOwner(req)
    ? { tenantId: req.auth!.tenantId, role: { $in: ['owner', 'admin'] }, active: { $ne: false } }
    : { tenantId: req.auth!.tenantId, _id: req.auth!.userId }
  return User.find(filter).select('name role').sort({ name: 1 }).lean()
}

const slotsOf = (userId: string) =>
  Object.fromEntries(SLOTS.map((slot) => [slot, getWaStatus(adminBotId(userId, slot))])) as Record<AdminSlot, ReturnType<typeof getWaStatus>>

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const admins = await visibleAdmins(req)
    res.json(admins.map((u) => ({ userId: String(u._id), name: u.name, role: u.role, slots: slotsOf(String(u._id)) })))
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: (err as Error).message })
  }
})

/** Pilihan pengirim untuk pengaturan campaign: WA Azera + semua nomor admin (status tersambung ikut) */
router.get('/senders', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const admins = await User.find({ tenantId: req.auth!.tenantId, role: { $in: ['owner', 'admin'] }, active: { $ne: false } }).select('name').sort({ name: 1 }).lean()
    res.json([
      { id: AZERA_SENDER, label: 'WA Azera (bot bawaan)', connected: true },
      ...admins.flatMap((u) => SLOTS.map((slot) => {
        const id = adminBotId(String(u._id), slot)
        const st = getWaStatus(id)
        return { id, label: `${u.name} · ${SLOT_LABEL[slot]}${st.connectedNumber ? ` (+${st.connectedNumber})` : ''}`, connected: st.status === 'connected' }
      })),
    ])
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: (err as Error).message })
  }
})

const slotRouter = Router({ mergeParams: true })
// Admin cuma boleh nomornya sendiri; owner boleh semua admin
slotRouter.use((req: AuthRequest, res: Response, next: NextFunction) => {
  const { userId, slot } = req.params
  if (!/^[a-f\d]{24}$/.test(userId) || !SLOTS.includes(slot as AdminSlot)) { res.status(400).json({ message: 'Slot WA tidak dikenal' }); return }
  if (!isOwner(req) && req.auth!.userId !== userId) { res.status(403).json({ message: 'Hanya bisa mengatur nomor WA sendiri' }); return }
  next()
})
router.use('/:userId/:slot', slotRouter)
const botOf = (req: AuthRequest) => adminBotId(req.params.userId, req.params.slot as AdminSlot)

slotRouter.get('/status', (req: AuthRequest, res: Response) => { res.json(getWaStatus(botOf(req))) })

slotRouter.get('/qr', async (req: AuthRequest, res: Response) => {
  const qr = getWaQr(botOf(req))
  res.json({ qr: qr ? await QRCode.toDataURL(qr) : null })
})

slotRouter.post('/connect', (req: AuthRequest, res: Response) => {
  if (devBotEnabled) { res.status(400).json({ message: 'Nomor WA admin hanya bisa disambungkan di server production.' }); return }
  connectWhatsApp(botOf(req)).catch((err) => console.error('WA admin connect error:', err))
  res.json(getWaStatus(botOf(req)))
})

slotRouter.post('/logout', async (req: AuthRequest, res: Response) => {
  await logoutWhatsApp(botOf(req))
  res.json(getWaStatus(botOf(req)))
})

export default router
