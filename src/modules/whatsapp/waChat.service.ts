import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import WaContact from './waContact.model'
import WaChatMessage, { WaChatDirection } from './waChatMessage.model'
import WaMessageLog from './waMessageLog.model'
import { BotId } from './waTemplate.model'

const PREVIEW_LEN = 80

/**
 * Sebelum pemisahan dua bot, semua data WA milik satu nomor (nomor lead/partnership).
 * Baris lama tidak punya field `bot` — set ke 'partnership' sekali saat startup, sebelum
 * index unik `{ tenantId, bot, jid }` disinkronkan. Idempoten (filter $exists:false).
 */
export async function backfillBotDiscriminator() {
  await connectDB()
  const filter = { bot: { $exists: false } }
  const patch = { $set: { bot: 'partnership' as const } }
  await Promise.all([
    WaContact.collection.updateMany(filter, patch),
    WaChatMessage.collection.updateMany(filter, patch),
    WaMessageLog.collection.updateMany(filter, patch),
  ])
}

export async function recordIncomingMessage(bot: BotId, jid: string, text: string, messageId?: string, pushName?: string) {
  await connectDB()
  const tenant = await getDefaultTenant()
  await WaChatMessage.create({ tenantId: tenant._id, bot, jid, direction: 'in', text, messageId })
  await WaContact.findOneAndUpdate(
    { tenantId: tenant._id, bot, jid },
    {
      $set: {
        lastMessageAt: new Date(),
        lastMessagePreview: text.slice(0, PREVIEW_LEN),
        ...(pushName ? { name: pushName } : {}),
      },
      $inc: { unreadCount: 1 },
      $setOnInsert: { botPaused: false },
    },
    { upsert: true }
  )
}

export async function recordOutgoingMessage(bot: BotId, jid: string, text: string) {
  await connectDB()
  const tenant = await getDefaultTenant()
  await WaChatMessage.create({ tenantId: tenant._id, bot, jid, direction: 'out', text })
  await WaContact.findOneAndUpdate(
    { tenantId: tenant._id, bot, jid },
    {
      $set: { lastMessageAt: new Date(), lastMessagePreview: text.slice(0, PREVIEW_LEN) },
      $setOnInsert: { botPaused: false, unreadCount: 0 },
    },
    { upsert: true }
  )
}

export async function isBotPaused(bot: BotId, jid: string): Promise<boolean> {
  await connectDB()
  const tenant = await getDefaultTenant()
  const contact = await WaContact.findOne({ tenantId: tenant._id, bot, jid })
  return contact?.botPaused ?? false
}

interface HistoryEntry {
  jid: string
  direction: WaChatDirection
  text: string
  messageId: string
  timestamp: Date
}

/** Sinkronisasi riwayat chat lama (dikirim Baileys sekali lewat event 'messaging-history.set' saat
 * device baru ditautkan) — dipisah dari recordIncomingMessage/recordOutgoingMessage karena datanya
 * bisa ratusan/ribuan pesan sekaligus, jadi ditulis pakai bulk write, bukan satu-satu. Upsert by
 * messageId supaya aman kalau event ini sampai terkirim ulang (reconnect dsb), tidak dobel.
 */
export async function backfillHistory(bot: BotId, entries: HistoryEntry[], contactNames: Record<string, string>) {
  if (!entries.length) return
  await connectDB()
  const tenant = await getDefaultTenant()

  const messageOps = entries
    .filter((e) => e.messageId)
    .map((e) => ({
      updateOne: {
        filter: { tenantId: tenant._id, bot, jid: e.jid, messageId: e.messageId },
        update: { $setOnInsert: { ...e, tenantId: tenant._id, bot, createdAt: e.timestamp } },
        upsert: true,
      },
    }))
  if (messageOps.length) {
    await WaChatMessage.bulkWrite(messageOps, { ordered: false }).catch((err) => console.error('WA history bulkWrite messages error:', err))
  }

  const latestByJid = new Map<string, HistoryEntry>()
  for (const e of entries) {
    const current = latestByJid.get(e.jid)
    if (!current || e.timestamp > current.timestamp) latestByJid.set(e.jid, e)
  }

  // Baca dulu kontak yang sudah ada, biar preview/lastMessageAt dari history TIDAK menimpa
  // pesan LIVE yang mungkin sudah lebih baru masuk duluan sebelum sync ini selesai diproses.
  const existing = await WaContact.find(
    { tenantId: tenant._id, bot, jid: { $in: Array.from(latestByJid.keys()) } },
    { jid: 1, lastMessageAt: 1 }
  )
  const existingByJid = new Map(existing.map((c) => [c.jid, c.lastMessageAt]))

  const contactOps = Array.from(latestByJid.entries()).map(([jid, e]) => {
    const current = existingByJid.get(jid)
    const isNewer = !current || e.timestamp > current
    return {
      updateOne: {
        filter: { tenantId: tenant._id, bot, jid },
        update: {
          $setOnInsert: { botPaused: false, unreadCount: 0 },
          $set: {
            ...(isNewer ? { lastMessageAt: e.timestamp, lastMessagePreview: e.text.slice(0, PREVIEW_LEN) } : {}),
            ...(contactNames[jid] ? { name: contactNames[jid] } : {}),
          },
        },
        upsert: true,
      },
    }
  })
  if (contactOps.length) {
    await WaContact.bulkWrite(contactOps, { ordered: false }).catch((err) => console.error('WA history bulkWrite contacts error:', err))
  }
}
