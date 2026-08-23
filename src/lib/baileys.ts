import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  ConnectionState,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import path from 'path'
import fs from 'fs/promises'
import WaMessageLog from '../modules/whatsapp/waMessageLog.model'
import { WaTrigger } from '../modules/whatsapp/waTemplate.model'

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

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

    sock = makeWASocket({ auth: state, logger })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
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
  } finally {
    connecting = false
  }
}

export async function logoutWhatsApp(): Promise<void> {
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
      const jid = `${item.to.replace(/\D/g, '')}@s.whatsapp.net`
      await sock.sendMessage(jid, { text: item.payload })
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
