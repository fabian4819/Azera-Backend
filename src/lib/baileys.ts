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
import { WaTrigger, BotId, BOT_IDS, audienceToBot } from '../modules/whatsapp/waTemplate.model'
import { DEFAULT_TEMPLATES } from '../modules/whatsapp/defaultTemplates'
import { handleIncomingMessage } from '../modules/whatsapp/leadBot.service'
import { recordIncomingMessage, recordOutgoingMessage, isBotPaused, backfillHistory } from '../modules/whatsapp/waChat.service'

const AUTH_ROOT = path.join(process.cwd(), 'auth_info_baileys')
const SEND_DELAY_MS = 3000 // jarak antar pesan — mitigasi risiko banned (AD-29)
const RECONNECT_DELAY_MS = 3000

const logger = pino({ level: 'silent' })

export type WaStatus = 'disconnected' | 'connecting' | 'qr' | 'connected'

interface QueueItem {
  logId: string
  to: string
  payload: string
}

/**
 * Satu koneksi Baileys independen. Sebelumnya semua state ini global di level modul
 * (satu bot). Sekarang dua instance: `partnership` (brand/klien) dan `creator` (KOL) —
 * masing-masing nomor, pairing, auth dir, dan antrian kirim sendiri.
 * docs/superpowers/specs/2026-09-10-whatsapp-dual-bot-design.md
 */
class WaBot {
  readonly id: BotId
  private readonly authDir: string

  private sock: WASocket | null = null
  private currentQr: string | null = null
  private status: WaStatus = 'disconnected'
  private connectedNumber: string | null = null
  private connecting = false

  // Baileys kadang mengirim event 'close' dari socket LAMA setelah socket BARU sudah dibuat
  // (mis. sock.logout() memicu close yang baru benar-benar sampai beberapa saat kemudian,
  // setelah user keburu klik Connect lagi). Tanpa penanda generasi ini, handler socket lama
  // bisa menimpa status/currentQr milik socket baru dan QR jadi tidak pernah muncul.
  private generation = 0

  private readonly queue: QueueItem[] = []
  private processing = false

  constructor(id: BotId) {
    this.id = id
    this.authDir = path.join(AUTH_ROOT, id)
  }

  getStatus() {
    return { status: this.status, connectedNumber: this.connectedNumber }
  }

  getQr() {
    return this.currentQr
  }

  async connect(): Promise<void> {
    if (this.connecting || this.status === 'connected') return
    this.connecting = true
    this.status = 'connecting'
    const myGeneration = ++this.generation

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir)

      // syncFullHistory: minta riwayat chat lengkap dari WhatsApp saat pairing (default Baileys cuma
      // kirim window singkat) — supaya inbox dashboard bisa terisi histori lama, bukan cuma pesan baru.
      const sock = makeWASocket({ auth: state, logger, syncFullHistory: true })
      this.sock = sock

      // Tanpa guard generasi di sini, socket LAMA yang masih menutup diri (mis. abis logout()) bisa
      // menulis ulang file auth setelah fs.rm() di logout() jalan — bikin folder auth kotor lagi walau
      // baru saja dibersihkan, dan koneksi berikutnya nyoba resume sesi basi (QR gak muncul).
      sock.ev.on('creds.update', () => {
        if (myGeneration !== this.generation) return
        saveCreds().catch((err) => console.error(`WA[${this.id}] saveCreds error:`, err))
      })

      sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
        if (myGeneration !== this.generation) return // socket ini sudah digantikan (logout/connect ulang) — abaikan event basi
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          this.currentQr = qr
          this.status = 'qr'
        }

        if (connection === 'open') {
          this.status = 'connected'
          this.currentQr = null
          this.connectedNumber = sock.user?.id?.split(':')[0] ?? null
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
            ?.statusCode
          const loggedOut = statusCode === DisconnectReason.loggedOut
          this.status = 'disconnected'
          this.currentQr = null
          this.sock = null
          if (loggedOut) {
            this.connectedNumber = null
            // WA sendiri yang sudah invalidate sesi ini (mis. device di-unlink dari HP) — kalau file
            // auth dibiarkan, setiap percobaan connect berikutnya cuma nyoba resume sesi mati ini lagi
            // dan diam-diam gagal tanpa pernah munculin QR baru. Hapus supaya connect berikutnya mulai
            // fresh dan benar-benar generate QR baru.
            fs.rm(this.authDir, { recursive: true, force: true }).catch((err) => console.error(`WA[${this.id}] rm auth dir error:`, err))
          } else {
            setTimeout(() => {
              this.connect().catch((err) => console.error(`WA[${this.id}] reconnect error:`, err))
            }, RECONNECT_DELAY_MS)
          }
        }
      })

      // Lead bot: pesan masuk dari lawan bicara → jalur bot ini (brand template / redirect KOL / support).
      // Diam untuk pesan grup, status broadcast, dan pesan dari diri sendiri (echo pengiriman lain).
      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (myGeneration !== this.generation) return
        if (type !== 'notify') return
        for (const msg of messages) {
          const jid = msg.key.remoteJid
          if (!jid || msg.key.fromMe) continue
          // Bantu cari JID grup: kirim pesan apa saja di grup target, lalu cek log server untuk JID-nya.
          if (jid.endsWith('@g.us')) {
            console.log(`WA[${this.id}] group message from ${jid}`)
            continue
          }
          if (jid === 'status@broadcast') continue
          const text = extractMessageText(msg)
          if (!text) continue
          recordIncomingMessage(this.id, jid, text, msg.key.id || undefined, msg.pushName || undefined).catch((err) => console.error(`WA[${this.id}] save incoming error:`, err))
          isBotPaused(this.id, jid)
            .then((paused) => {
              if (!paused) handleIncomingMessage(this.id, jid, text).catch((err) => console.error(`WA[${this.id}] bot error:`, err))
            })
            .catch((err) => console.error(`WA[${this.id}] bot-pause check error:`, err))
        }
      })

      // Sinkron riwayat chat lama yang sudah ada di WhatsApp SEBELUM device ini ditautkan —
      // Baileys mengirim ini sekali (kadang dalam beberapa batch) setelah pairing sukses.
      sock.ev.on('messaging-history.set', ({ messages, contacts }) => {
        if (myGeneration !== this.generation) return
        const contactNames: Record<string, string> = {}
        for (const c of contacts) {
          const name = c.name || c.notify
          if (c.id && name) contactNames[c.id] = name
        }

        const entries = []
        for (const msg of messages) {
          const jid = msg.key.remoteJid
          if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue
          const text = extractMessageText(msg)
          if (!text || !msg.key.id) continue
          const seconds = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp) || 0
          entries.push({
            jid,
            direction: (msg.key.fromMe ? 'out' : 'in') as 'in' | 'out',
            text,
            messageId: msg.key.id,
            timestamp: seconds ? new Date(seconds * 1000) : new Date(),
          })
        }

        if (entries.length) {
          backfillHistory(this.id, entries, contactNames).catch((err) => console.error(`WA[${this.id}] history sync error:`, err))
        }
      })
    } finally {
      this.connecting = false
    }
  }

  async logout(): Promise<void> {
    this.generation++ // socket lama (kalau masih ada event close/creds.update yang nyusul) langsung dianggap basi
    if (this.sock) {
      await this.sock.logout().catch((err) => console.error(`WA[${this.id}] logout() error:`, err))
    }
    this.sock = null
    // Hapus folder auth SEBELUM status jadi 'disconnected', supaya tidak ada window sempit di mana
    // klik Connect keburu jalan dan baca folder auth yang masih dalam proses dihapus.
    await fs.rm(this.authDir, { recursive: true, force: true }).catch((err) => console.error(`WA[${this.id}] rm auth dir error:`, err))
    this.status = 'disconnected'
    this.currentQr = null
    this.connectedNumber = null
  }

  /** Balasan langsung bot percakapan (leadBot.service) — bypass queue karena ini interaktif, bukan notifikasi batch */
  async sendDirect(to: string, text: string): Promise<void> {
    if (!this.sock || this.status !== 'connected') return
    try {
      await this.sock.sendMessage(toJid(to), { text })
      recordOutgoingMessage(this.id, to, text).catch((err) => console.error(`WA[${this.id}] save outgoing error:`, err))
    } catch (err) {
      console.error(`WA[${this.id}] sendDirect error:`, err)
    }
  }

  /** Balasan manual admin dari inbox dashboard — error dilempar balik ke route (biar admin tahu kalau gagal). */
  async sendManual(jid: string, text: string): Promise<void> {
    if (!this.sock || this.status !== 'connected') throw new Error('WhatsApp belum terhubung')
    await this.sock.sendMessage(toJid(jid), { text })
    await recordOutgoingMessage(this.id, jid, text)
  }

  enqueue(logId: string, to: string, payload: string) {
    this.queue.push({ logId, to, payload })
    this.processQueue().catch(() => {})
  }

  private async processQueue() {
    if (this.processing) return
    this.processing = true
    while (this.queue.length) {
      const item = this.queue.shift()!
      try {
        if (!this.sock || this.status !== 'connected') throw new Error('WhatsApp belum terhubung')
        await this.sock.sendMessage(toJid(item.to), { text: item.payload })
        await WaMessageLog.findByIdAndUpdate(item.logId, { status: 'sent', sentAt: new Date() })
        recordOutgoingMessage(this.id, item.to, item.payload).catch((err) => console.error(`WA[${this.id}] save outgoing error:`, err))
      } catch (err) {
        await WaMessageLog.findByIdAndUpdate(item.logId, { status: 'failed', error: (err as Error).message })
      }
      if (this.queue.length) await new Promise((r) => setTimeout(r, SEND_DELAY_MS))
    }
    this.processing = false
  }
}

const bots: Record<BotId, WaBot> = BOT_IDS.reduce(
  (acc, id) => ({ ...acc, [id]: new WaBot(id) }),
  {} as Record<BotId, WaBot>
)

export function getWaStatus(botId: BotId) {
  return bots[botId].getStatus()
}

export function getWaQr(botId: BotId) {
  return bots[botId].getQr()
}

export function connectWhatsApp(botId: BotId): Promise<void> {
  return bots[botId].connect()
}

export function connectAllBots(): void {
  for (const id of BOT_IDS) {
    bots[id].connect().catch((err) => console.error(`WA[${id}] connect error:`, err))
  }
}

export function logoutWhatsApp(botId: BotId): Promise<void> {
  return bots[botId].logout()
}

export function sendDirectMessage(botId: BotId, to: string, text: string): Promise<void> {
  return bots[botId].sendDirect(to, text)
}

export function sendManualReply(botId: BotId, jid: string, text: string): Promise<void> {
  return bots[botId].sendManual(jid, text)
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

export async function enqueueWaMessage(opts: {
  tenantId: string
  trigger: WaTrigger
  to: string
  payload: string
  campaignId?: string
  creatorId?: string
  /** Override tujuan bot — hanya dipakai test-send; trigger lain diarahkan otomatis lewat audience template. */
  bot?: BotId
}) {
  const botId = opts.bot ?? audienceToBot[DEFAULT_TEMPLATES[opts.trigger].audience]
  const log = await WaMessageLog.create({
    tenantId: opts.tenantId,
    bot: botId,
    trigger: opts.trigger,
    to: opts.to,
    payload: opts.payload,
    campaignId: opts.campaignId,
    creatorId: opts.creatorId,
    status: 'queued',
  })
  bots[botId].enqueue(log._id.toString(), opts.to, opts.payload)
  return log
}
