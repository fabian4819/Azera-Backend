import type { WASocket, proto, GroupParticipant } from '@whiskeysockets/baileys'
import TagBotGroup, { ITagBotGroup } from './tagBotGroup.model'

/**
 * Bot tag grup (port dari repo bot-tag-whatsapp yang dulu jalan sendiri di fabian-vps), sekarang
 * menumpang di bot `creator` (WA community). Command: !tagall/!everyone, !tag <nomor...>, !autoleave, !info.
 * Bot keluar otomatis dari grup 30 hari setelah masuk, kecuali grup yang di-exclude.
 */

const AUTO_LEAVE_DAYS = 30
const DAY_MS = 24 * 3600_000
const SHEET_WEBHOOK_URL = process.env.TAG_BOT_SHEET_WEBHOOK_URL || ''
const SHEET_WEBHOOK_SECRET = process.env.TAG_BOT_SHEET_WEBHOOK_SECRET || ''

export interface TagBotIO {
  sock: WASocket
  /** Kirim lewat WaBot supaya echo-nya dikenali & tercatat di inbox */
  send: (jid: string, text: string, mentions?: string[]) => Promise<void>
}

// Nomor (62xxx) → jid peserta. Peserta @lid tidak selalu membawa nomor di groupMetadata, nomornya
// dipelajari dari key.participantPn tiap pesan grup.
// ponytail: Map in-memory tanpa batas & hilang saat restart, cukup untuk skala grup campaign.
const phoneToJid = new Map<string, string>()

export function learnParticipant(key: proto.IMessageKey & { participantPn?: string | null }) {
  const pn = key.participantPn?.split('@')[0]
  if (pn && key.participant) phoneToJid.set(normalizePhone(pn), key.participant)
}

/** "0812-3456-7890" / "+62812..." / "812..." → "62812..." */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.startsWith('0')) return '62' + d.slice(1)
  if (d.startsWith('62')) return d
  return '62' + d
}

// Token nomor: diawali 0 / 62 / +62, atau 8/9 tanpa 0 (mis. 882015861262). Tidak boleh nempel ke huruf
// (mis. "aestheticvibes2505" bukan nomor).
const PHONE_TOKEN = /(?<![\w])((?:\+?62|0)\d[\d-]{7,14}|[89]\d{9,12})(?![\w])/g

export function extractPhoneTokens(text: string): string[] {
  return [...new Set([...text.matchAll(PHONE_TOKEN)].map((m) => m[1]))]
}

function participantPhone(p: GroupParticipant): string | undefined {
  if (p.id.endsWith('@s.whatsapp.net')) return p.id.split('@')[0]
  if (p.jid?.endsWith('@s.whatsapp.net')) return p.jid.split('@')[0]
  return undefined
}

/** Jalankan command tag di grup, diam kalau teks bukan command */
export async function handleTagCommand(io: TagBotIO, msg: proto.IWebMessageInfo, text: string): Promise<void> {
  const jid = msg.key.remoteJid!
  const cmd = text.trim()
  try {
    if (/^!(tagall|everyone)\b/.test(cmd)) return await tagAll(io, jid, cmd)
    if (/^!tag(\s|$)/.test(cmd)) return await tagSpecific(io, jid, cmd)
    if (/^!autoleave\b/.test(cmd)) return await autoLeaveInfo(io, jid, cmd, !!msg.key.fromMe)
    if (cmd === '!info') {
      return await io.send(jid, '🤖 *WhatsApp Tag All Bot*\n\nCommands:\n' +
        '• !tagall [pesan] - Tag semua member\n' +
        '• !everyone [pesan] - Tag semua member\n' +
        '• !tag - Tag member spesifik (tulis nomor per baris)\n' +
        '• !autoleave - Info jadwal bot keluar dari grup\n' +
        '• !info - Info bot')
    }
  } catch (err) {
    console.error('tagBot command error:', err)
    await io.send(jid, '❌ Terjadi error saat memproses command').catch(() => undefined)
  }
}

async function tagAll(io: TagBotIO, jid: string, cmd: string) {
  const { participants } = await io.sock.groupMetadata(jid)
  const custom = cmd.replace(/^!(tagall|everyone)\s*/, '').trim()
  const lines = participants.map((p, i) => `${i + 1}. @${p.id.split('@')[0]}`)
  await io.send(jid, `${custom ? `📢 ${custom}` : '📢 *Mention All Members*'}\n\n${lines.join('\n')}`, participants.map((p) => p.id))
}

async function tagSpecific(io: TagBotIO, jid: string, cmd: string) {
  const content = cmd.replace(/^!tag\s*/, '')
  const tokens = extractPhoneTokens(content)
  if (!tokens.length) {
    return io.send(jid, '❌ Format salah! Gunakan:\n\n*Format 1 (inline):*\n!tag 082232018289 085161885170 pesan custom\n\n' +
      '*Format 2 (multi-line):*\n!tag\nPESAN PERTAMA\n082232018289\n\nPESAN KEDUA\n085161885170')
  }

  const { participants } = await io.sock.groupMetadata(jid)
  const members = new Map(phoneToJid)
  for (const p of participants) {
    const pn = participantPhone(p)
    if (pn) members.set(normalizePhone(pn), p.id)
  }
  const inGroup = new Set(participants.map((p) => p.id))

  const mentions: string[] = []
  let out = content
  // Token terpanjang dulu supaya nomor yang jadi bagian nomor lain tidak terganti duluan
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    const target = members.get(normalizePhone(token))
    const found = target !== undefined && inGroup.has(target)
    if (found) mentions.push(target)
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'g'), found ? `@${target.split('@')[0]}` : `${token} (tidak ada di grup)`)
  }
  await io.send(jid, out, mentions)
}

async function autoLeaveInfo(io: TagBotIO, jid: string, cmd: string, fromMe: boolean) {
  // `!autoleave off|on` cuma dari HP nomor bot sendiri (admin), supaya member grup tidak bisa menahan bot
  const toggle = cmd.match(/^!autoleave\s+(on|off)$/)?.[1]
  if (toggle && fromMe) {
    await TagBotGroup.updateOne({ groupId: jid }, { excluded: toggle === 'off' })
  }
  const g = await TagBotGroup.findOne({ groupId: jid }).lean()
  if (!g) return io.send(jid, 'Belum ada data auto-leave untuk grup ini.')
  const fmt = (d: Date) => new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })
  await io.send(jid, `*Auto Leave Grup*\n\nNama: ${g.subject || '-'}\nTanggal masuk: ${fmt(g.joinedAt)}\n` +
    (g.excluded ? 'Keluar otomatis: tidak (grup dikecualikan)' : `Keluar otomatis: ${fmt(g.leaveAfterAt)}`))
}

const leaveAfter = (joinedAt: Date) => new Date(joinedAt.getTime() + AUTO_LEAVE_DAYS * DAY_MS)

// ponytail: sinkron yang datang saat sinkron lain berjalan dilewati, tertangkap di sinkron tiap jam berikutnya
let syncing = false
/**
 * Sinkron daftar grup dengan WhatsApp lalu keluar dari grup yang sudah lewat 30 hari. Dipanggil saat
 * bot tersambung dan tiap jam. Pertama kali jalan (koleksi kosong), semua grup yang sudah diikuti bot
 * community dicatat `excluded`: itu grup komunitas/tim, bukan grup campaign yang perlu ditinggal.
 */
export async function syncTagGroups(io: TagBotIO): Promise<void> {
  if (syncing) return
  syncing = true
  try { await doSync(io) } finally { syncing = false }
}

async function doSync(io: TagBotIO) {
  const all = Object.values(await io.sock.groupFetchAllParticipating()).filter((g) => !g.isCommunity)
  const now = new Date()
  const firstRun = (await TagBotGroup.estimatedDocumentCount()) === 0
  const known = new Map((await TagBotGroup.find().lean()).map((g) => [g.groupId, g]))

  for (const g of all) {
    const rec = known.get(g.id)
    if (rec?.status === 'active') {
      if (g.subject && rec.subject !== g.subject) await TagBotGroup.updateOne({ groupId: g.id }, { subject: g.subject })
      continue
    }
    // Grup baru, atau masuk lagi setelah pernah keluar: hitung 30 hari dari sekarang
    const doc = await TagBotGroup.findOneAndUpdate(
      { groupId: g.id },
      { subject: g.subject, joinedAt: now, leaveAfterAt: leaveAfter(now), status: 'active', $unset: { leftAt: 1, lastError: 1 }, ...(firstRun ? { excluded: true } : {}) },
      { upsert: true, new: true }
    )
    if (!doc.excluded) {
      console.log(`tagBot: grup tercatat "${g.subject}", auto-leave ${doc.leaveAfterAt.toISOString()}`)
      sheetEvent('group_tracked', doc)
    }
  }

  // Sudah tidak jadi member (dikeluarkan / keluar manual dari HP)
  const ids = new Set(all.map((g) => g.id))
  for (const rec of known.values()) {
    if (rec.status !== 'active' || ids.has(rec.groupId)) continue
    const doc = await TagBotGroup.findOneAndUpdate({ groupId: rec.groupId }, { status: 'left', leftAt: now }, { new: true })
    if (doc && !doc.excluded) sheetEvent('group_left', doc)
  }

  const expired = await TagBotGroup.find({ status: 'active', excluded: false, leaveAfterAt: { $lte: now } })
  for (const rec of expired) {
    try {
      await io.send(rec.groupId, `Bot otomatis keluar karena sudah ${AUTO_LEAVE_DAYS} hari berada di grup ini.`)
      await io.sock.groupLeave(rec.groupId)
      rec.status = 'left'
      rec.leftAt = new Date()
      rec.lastError = undefined
      await rec.save()
      console.log(`tagBot: auto leave "${rec.subject}"`)
      sheetEvent('group_left', rec)
    } catch (err) {
      rec.lastError = (err as Error).message
      await rec.save()
      console.error(`tagBot: gagal auto leave ${rec.groupId}:`, err)
    }
  }
}

/** Catat ke sheet "All Track" lewat Apps Script (google-apps-script-all-track.js di repo bot lama). Best-effort. */
function sheetEvent(event: 'group_tracked' | 'group_left', g: ITagBotGroup) {
  if (!SHEET_WEBHOOK_URL) return
  fetch(SHEET_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: SHEET_WEBHOOK_SECRET, event, sessionName: 'creator',
      groupId: g.groupId, subject: g.subject, joinedAt: g.joinedAt, firstSeenAt: g.joinedAt,
      leaveAfterAt: g.leaveAfterAt, leftAt: g.leftAt, source: 'creator', status: g.status,
    }),
  })
    // Apps Script membalas 200 + { ok:false } untuk secret salah / sheet tidak ada
    .then(async (r) => { const body = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null; if (!r.ok || !body?.ok) throw new Error(body?.error || `HTTP ${r.status}`) })
    .catch((err) => console.error(`tagBot: sheet ${event} gagal:`, err.message))
}
