import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  ConnectionState,
  proto,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import path from 'path'
import fs from 'fs/promises'
import WaMessageLog from '../modules/whatsapp/waMessageLog.model'
import { WaTrigger } from '../modules/whatsapp/waTemplate.model'
import { handleIncomingMessage } from '../modules/whatsapp/leadBot.service'

const AUTH_DIR = path.join(process.cwd(), 'auth_info_baileys')
const SEND_DELAY_MS = 3000 // jarak antar pesan — mitigasi risiko banned (AD-29)
const RECONNECT_DELAY_MS = 3000

const logger = pino({ level: 'silent' })

export type WaStatus = 'disconnected' | 'connecting' | 'qr' | 'connected'

let sock: WASocket | null = null
let currentQr: string | null = null
let status: WaStatus = 'disconnected'
let connectedNumber: string | null = null
let connecting = false

// Baileys kadang mengirim event 'close' dari socket LAMA setelah socket BARU sudah dibuat
// (mis. sock.logout() memicu close yang baru benar-benar sampai beberapa saat kemudian,
// setelah user keburu klik Connect lagi). Tanpa penanda generasi ini, handler socket lama
// bisa menimpa status/currentQr milik socket baru dan QR jadi tidak pernah muncul.
let generation = 0

export function getWaStatus() {
  return { status, connectedNumber }
}

export function getWaQr() {
  return currentQr
}

export async function connectWhatsApp(): Promise<void> {
  if (connecting || status === 'connected') return
  connecting = true
  status = 'connecting'
  const myGeneration = ++generation

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

    sock = makeWASocket({ auth: state, logger })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      if (myGeneration !== generation) return // socket ini sudah digantikan (logout/connect ulang) — abaikan event basi
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        currentQr = qr
        status = 'qr'
      }

      if (connection === 'open') {
        status = 'connected'
        currentQr = null
        connectedNumber = sock?.user?.id?.split(':')[0] ?? null
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
          ?.statusCode
        const loggedOut = statusCode === DisconnectReason.loggedOut
        status = 'disconnected'
        currentQr = null
        sock = null
        if (loggedOut) {
          connectedNumber = null
        } else {
          setTimeout(() => {
            connectWhatsApp().catch(() => {})
          }, RECONNECT_DELAY_MS)
        }
      }
    })

    // Lead bot: pesan masuk dari lawan bicara → arahkan ke menu Brand/KOL/Support (docs/plan/modul-4-automation-workflow.md).
    // Diam untuk pesan grup, status broadcast, dan pesan dari diri sendiri (echo pengiriman lain).
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (myGeneration !== generation) return
      if (type !== 'notify') return
      for (const msg of messages) {
        const jid = msg.key.remoteJid
        if (!jid || msg.key.fromMe) continue
        // Bantu cari JID grup: kirim pesan apa saja di grup target, lalu cek log server untuk JID-nya,
        // supaya bisa ditempel ke field tujuan (mis. Brand.whatsapp) untuk kirim report/broadcast ke grup itu.
        if (jid.endsWith('@g.us')) {
          console.log(`WA group message from ${jid}`)
          continue
        }
        if (jid === 'status@broadcast') continue
        const text = extractMessageText(msg)
        if (!text) continue
        handleIncomingMessage(jid, text).catch((err) => console.error('WA bot error:', err))
      }
    })
  } finally {
    connecting = false
  }
}

function extractMessageText(msg: proto.IWebMessageInfo): string | null {
  const m = msg.message
  if (!m) return null
  return m.conversation || m.extendedTextMessage?.text || m.buttonsResponseMessage?.selectedDisplayText || null
}

// `to` bisa berupa nomor HP biasa (dikirim 1:1) ATAU JID grup WhatsApp (mis. "12036301234567890@g.us")
// yang sudah disimpan apa adanya di field tujuan (misal Brand.whatsapp) — kalau sudah mengandung "@"
// dianggap JID lengkap dan dipakai langsung, supaya broadcast/report bisa diarahkan ke grup.
function toJid(to: string): string {
  return to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`
}

/** Balasan langsung bot percakapan (leadBot.service) — bypass queue karena ini interaktif, bukan notifikasi batch */
export async function sendDirectMessage(to: string, text: string): Promise<void> {
  if (!sock || status !== 'connected') return
  try {
    await sock.sendMessage(toJid(to), { text })
  } catch (err) {
    console.error('WA bot sendDirectMessage error:', err)
  }
}

export async function logoutWhatsApp(): Promise<void> {
  generation++ // socket lama (kalau masih ada event close yang nyusul) langsung dianggap basi
  if (sock) {
    await sock.logout().catch(() => {})
  }
  await fs.rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {})
  sock = null
  status = 'disconnected'
  currentQr = null
  connectedNumber = null
}

interface QueueItem {
  logId: string
  to: string
  payload: string
}

const queue: QueueItem[] = []
let processing = false

async function processQueue() {
  if (processing) return
  processing = true
  while (queue.length) {
    const item = queue.shift()!
    try {
      if (!sock || status !== 'connected') throw new Error('WhatsApp belum terhubung')
      await sock.sendMessage(toJid(item.to), { text: item.payload })
      await WaMessageLog.findByIdAndUpdate(item.logId, { status: 'sent', sentAt: new Date() })
    } catch (err) {
      await WaMessageLog.findByIdAndUpdate(item.logId, { status: 'failed', error: (err as Error).message })
    }
    if (queue.length) await new Promise((r) => setTimeout(r, SEND_DELAY_MS))
  }
  processing = false
}

export async function enqueueWaMessage(opts: {
  tenantId: string
  trigger: WaTrigger
  to: string
  payload: string
  campaignId?: string
  creatorId?: string
}) {
  const log = await WaMessageLog.create({ ...opts, status: 'queued' })
  queue.push({ logId: log._id.toString(), to: opts.to, payload: opts.payload })
  processQueue().catch(() => {})
  return log
}
