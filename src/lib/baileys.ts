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
import { recordIncomingMessage, recordOutgoingMessage, backfillHistory, pauseBotForContact } from '../modules/whatsapp/waChat.service'

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

  // Nama grup (subject) tidak ikut di setiap event pesan grup, cuma bisa didapat lewat
  // sock.groupMetadata() (panggilan API terpisah) — di-cache di memori supaya tidak nge-hit
  // API itu berulang-ulang untuk grup yang sama tiap pesan masuk.
  private readonly groupNames = new Map<string, string>()

  // Message id dari tiap pesan yang KITA kirim (dashboard/bot) — dicek di listener messages.upsert
  // supaya echo pengiriman sendiri tidak dicatat dobel sebagai "pesan dari HP fisik". Diisi SYNCHRONOUS
  // begitu sock.sendMessage() selesai (sebelum recordOutgoingMessage yang async), jadi tidak ada celah
  // race seperti kalau pakai cek ke database. Entry dibuang begitu echo-nya terpakai (lihat delete() di listener).
  private readonly sentMessageIds = new Set<string>()

  constructor(id: BotId) {
    this.id = id
    this.authDir = path.join(AUTH_ROOT, id)
  }

  private async resolveGroupName(jid: string): Promise<string | undefined> {
    const cached = this.groupNames.get(jid)
    if (cached) return cached
    if (!this.sock) return undefined
    try {
      const meta = await this.sock.groupMetadata(jid)
      if (meta.subject) this.groupNames.set(jid, meta.subject)
      return meta.subject
    } catch (err) {
      console.error(`WA[${this.id}] groupMetadata error:`, err)
      return undefined
    }
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
      // Grup direkam untuk visibilitas Inbox admin saja (TIDAK masuk alur lead bot — brand/KOL adalah
      // percakapan 1:1). Pesan dari nomor bot sendiri (fromMe) direkam kalau BELUM pernah tercatat —
      // itu tandanya dikirim langsung dari HP fisik, bukan echo dari kiriman dashboard/bot kita sendiri.
      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (myGeneration !== this.generation) return
        if (type !== 'notify') return
        for (const msg of messages) {
          const jid = msg.key.remoteJid
          if (!jid || jid === 'status@broadcast') continue
          const text = extractMessageText(msg)
          if (!text) continue
          const isGroup = jid.endsWith('@g.us')

          if (msg.key.fromMe) {
            const messageId = msg.key.id
            if (messageId && this.sentMessageIds.delete(messageId)) continue // echo dari kiriman kita sendiri (dashboard/bot) — sudah dicatat saat dikirim
            recordOutgoingMessage(this.id, jid, text, { messageId: messageId || undefined }).catch((err) => console.error(`WA[${this.id}] save phone-outgoing error:`, err))
            // Admin balas manual dari HP = ambil alih chat, bot berhenti untuk kontak ini (tidak berlaku utk grup, tidak ada alur bot di grup)
            if (!isGroup) pauseBotForContact(this.id, jid).catch((err) => console.error(`WA[${this.id}] auto-pause error:`, err))
            continue
          }

          if (isGroup) {
            this.resolveGroupName(jid)
              .then((name) => recordIncomingMessage(this.id, jid, text, { messageId: msg.key.id || undefined, name, senderName: msg.pushName || undefined, senderPhone: participantPhoneFromKey(msg.key) }))
              .catch((err) => console.error(`WA[${this.id}] save group incoming error:`, err))
            continue // pesan grup tidak dilempar ke leadBot.service — brand/KOL adalah alur 1:1
          }

          recordIncomingMessage(this.id, jid, text, { messageId: msg.key.id || undefined, name: msg.pushName || undefined, phone: phoneFromKey(jid, msg.key) }).catch((err) => console.error(`WA[${this.id}] save incoming error:`, err))
          // Pengecekan bot-paused sekarang di dalam handleIncomingMessage (leadBot.service.ts) —
          // supaya pesan berformat template Brand tetap diproses meski nomor ini di-pause admin.
          handleIncomingMessage(this.id, jid, text).catch((err) => console.error(`WA[${this.id}] bot error:`, err))
        }
      })

      // Sinkron riwayat chat lama yang sudah ada di WhatsApp SEBELUM device ini ditautkan —
      // Baileys mengirim ini sekali (kadang dalam beberapa batch) setelah pairing sukses. Termasuk
      // grup sekarang — nama grup (subject) datang dari `chats`, BUKAN dari `contacts` (yang isinya
      // orang, bukan grup).
      sock.ev.on('messaging-history.set', ({ messages, contacts, chats }) => {
        if (myGeneration !== this.generation) return
        const contactNames: Record<string, string> = {}
        const contactPhones: Record<string, string> = {}
        for (const c of contacts) {
          const name = c.name || c.notify
          if (c.id && name) contactNames[c.id] = name
          // c.id sering @lid — nomor asli ada di c.jid. Petakan dua-duanya supaya cocok dgn remoteJid pesan.
          const pn = digitsOf(c.jid?.split('@')[0])
          if (pn) {
            if (c.id) contactPhones[c.id] = pn
            if (c.lid) contactPhones[c.lid] = pn
          }
        }
        for (const c of chats) {
          if (c.id && c.name) {
            contactNames[c.id] = c.name
            if (c.id.endsWith('@g.us')) this.groupNames.set(c.id, c.name) // isi cache grup sekalian
          }
        }

        const entries = []
        for (const msg of messages) {
          const jid = msg.key.remoteJid
          if (!jid || jid === 'status@broadcast') continue
          const text = extractMessageText(msg)
          if (!text || !msg.key.id) continue
          const isGroup = jid.endsWith('@g.us')
          const seconds = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp) || 0
          if (!isGroup) {
            const pn = phoneFromKey(jid, msg.key)
            if (pn && !contactPhones[jid]) contactPhones[jid] = pn
          }
          entries.push({
            jid,
            direction: (msg.key.fromMe ? 'out' : 'in') as 'in' | 'out',
            text,
            messageId: msg.key.id,
            timestamp: seconds ? new Date(seconds * 1000) : new Date(),
            senderName: isGroup ? msg.pushName || undefined : undefined,
            senderPhone: isGroup ? participantPhoneFromKey(msg.key) : undefined,
          })
        }

        if (entries.length) {
          backfillHistory(this.id, entries, contactNames, contactPhones).catch((err) => console.error(`WA[${this.id}] history sync error:`, err))
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
      const sent = await this.sock.sendMessage(toJid(to), { text })
      if (sent?.key.id) this.sentMessageIds.add(sent.key.id)
      recordOutgoingMessage(this.id, to, text, { messageId: sent?.key.id || undefined }).catch((err) => console.error(`WA[${this.id}] save outgoing error:`, err))
    } catch (err) {
      console.error(`WA[${this.id}] sendDirect error:`, err)
    }
  }

  /** Balasan manual admin dari inbox dashboard — error dilempar balik ke route (biar admin tahu kalau gagal). */
  async sendManual(jid: string, text: string): Promise<void> {
    if (!this.sock || this.status !== 'connected') throw new Error('WhatsApp belum terhubung')
    const sent = await this.sock.sendMessage(toJid(jid), { text })
    if (sent?.key.id) this.sentMessageIds.add(sent.key.id)
    await recordOutgoingMessage(this.id, jid, text, { messageId: sent?.key.id || undefined })
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
        const sent = await this.sock.sendMessage(toJid(item.to), { text: item.payload })
        if (sent?.key.id) this.sentMessageIds.add(sent.key.id)
        await WaMessageLog.findByIdAndUpdate(item.logId, { status: 'sent', sentAt: new Date() })
        recordOutgoingMessage(this.id, item.to, item.payload, { messageId: sent?.key.id || undefined }).catch((err) => console.error(`WA[${this.id}] save outgoing error:`, err))
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

function digitsOf(s?: string | null): string | undefined {
  const d = (s || '').replace(/\D/g, '')
  return d.length >= 8 ? d : undefined
}

// WhatsApp generasi baru pakai remoteJid @lid (ID anonim, bukan nomor). Nomor asli lawan bicara
// ada di key.senderPn. Kalau remoteJid sendiri sudah @s.whatsapp.net, itu langsung nomornya.
function phoneFromKey(remoteJid: string, key: proto.IMessageKey & { senderPn?: string | null }): string | undefined {
  if (remoteJid.endsWith('@s.whatsapp.net')) return digitsOf(remoteJid.split('@')[0])
  return digitsOf(key.senderPn?.split('@')[0])
}

// Sama seperti phoneFromKey, tapi untuk PENGIRIM DI DALAM GRUP — remoteJid pesan grup adalah jid
// grupnya sendiri, bukan pengirim, jadi identitas pengirim harus dari key.participant (bisa juga @lid)
// + key.participantPn sebagai nomor aslinya.
function participantPhoneFromKey(key: proto.IMessageKey & { participantPn?: string | null }): string | undefined {
  const participant = key.participant
  if (!participant) return undefined
  if (participant.endsWith('@s.whatsapp.net')) return digitsOf(participant.split('@')[0])
  return digitsOf(key.participantPn?.split('@')[0])
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
