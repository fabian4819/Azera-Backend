/**
 * Self-check bot tag: parsing nomor & penggantian nomor → @mention (salah = tag orang yang salah).
 *
 * Jalankan: npx tsx server/src/modules/whatsapp/tagBot.selfcheck.ts
 */
import assert from 'node:assert/strict'
import type { proto } from '@whiskeysockets/baileys'
import { extractPhoneTokens, normalizePhone, handleTagCommand, learnParticipant, TagBotIO } from './tagBot.service'

assert.equal(normalizePhone('0822-3201-8289'), '6282232018289')
assert.equal(normalizePhone('+6282232018289'), '6282232018289')
assert.equal(normalizePhone('882015861262'), '62882015861262')
assert.deepEqual(extractPhoneTokens('!tag 082232018289 aestheticvibes2505 882015861262 halo'), ['082232018289', '882015861262'])

const sent: { text: string; mentions?: string[] }[] = []
const io = {
  sock: {
    groupMetadata: async () => ({
      participants: [
        { id: '6282232018289@s.whatsapp.net' },
        { id: '111@lid', jid: '6285161885170@s.whatsapp.net' },
        { id: '222@lid' }, // nomor tidak ada di metadata, dipelajari dari participantPn pesan
      ],
    }),
  },
  send: async (_jid: string, text: string, mentions?: string[]) => { sent.push({ text, mentions }) },
} as unknown as TagBotIO
const msg = (text: string) => ({ key: { remoteJid: 'g@g.us' }, message: { conversation: text } }) as proto.IWebMessageInfo

learnParticipant({ participant: '222@lid', participantPn: '6287800073210@s.whatsapp.net' } as proto.IMessageKey)

void (async () => {
  const tag = '!tag 082232018289 085161885170\n087800073210 meeting jam 3\n081111111111'
  await handleTagCommand(io, msg(tag), tag)
  assert.equal(sent[0].text, '@6282232018289 @111\n@222 meeting jam 3\n081111111111 (tidak ada di grup)')
  assert.deepEqual(sent[0].mentions?.sort(), ['111@lid', '222@lid', '6282232018289@s.whatsapp.net'])

  await handleTagCommand(io, msg('!tagall rapat'), '!tagall rapat')
  assert.equal(sent[1].text, '📢 rapat\n\n1. @6282232018289\n2. @111\n3. @222')
  assert.equal(sent[1].mentions?.length, 3)

  await handleTagCommand(io, msg('!tagihan bulan ini'), '!tagihan bulan ini') // bukan command
  assert.equal(sent.length, 2)

  console.log('tagBot.selfcheck OK')
})()
