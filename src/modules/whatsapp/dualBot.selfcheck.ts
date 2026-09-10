/**
 * Self-check rute dua-bot: setiap trigger outbound HARUS jatuh ke satu koneksi bot
 * yang valid, dan pemisahan creator/partnership harus sesuai audience template.
 * Salah rute = notifikasi terkirim dari nomor yang salah.
 *
 * Jalankan: npx tsx server/src/modules/whatsapp/dualBot.selfcheck.ts
 */
import assert from 'node:assert/strict'
import { WA_TRIGGERS, BOT_IDS, audienceToBot } from './waTemplate.model'
import { DEFAULT_TEMPLATES } from './defaultTemplates'

const botFor = (t: (typeof WA_TRIGGERS)[number]) => audienceToBot[DEFAULT_TEMPLATES[t].audience]

// Semua trigger memetakan ke bot yang dikenal
for (const t of WA_TRIGGERS) {
  assert.ok(BOT_IDS.includes(botFor(t)), `trigger ${t} -> bot tidak valid`)
}

// Dua bot, tidak lebih
assert.deepEqual([...BOT_IDS].sort(), ['creator', 'partnership'])

// Pemisahan konkret
assert.equal(botFor('brief_campaign'), 'creator')
assert.equal(botFor('reminder_draft'), 'creator')
assert.equal(botFor('broadcast_campaign'), 'creator')
assert.equal(botFor('creator_accepted'), 'creator')
assert.equal(botFor('invoice_new'), 'partnership')
assert.equal(botFor('invoice_paid'), 'partnership')
assert.equal(botFor('campaign_started'), 'partnership')
assert.equal(botFor('daily_progress_report'), 'partnership')

console.log('dualBot.selfcheck OK —', WA_TRIGGERS.length, 'trigger dirutekan')
