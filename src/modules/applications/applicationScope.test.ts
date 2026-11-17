/** Cek satu-jalan: `npx tsx src/modules/applications/applicationScope.test.ts` */
import assert from 'node:assert'
import { submissionBelongsTo, creatorViewFor, snapshotMatches } from './applicationScope'
import { buzzerLimits } from '../campaigns/campaign.model'

const t = 't', c = 'camp'
const legacy = { _id: 'a0', tenantId: t, campaignId: c, creatorId: 'cr1' }
const acc1 = { _id: 'a1', tenantId: t, campaignId: c, creatorId: 'cr1', account: { platform: 'tiktok', username: 'Eka.One', followers: 10 } }
const acc2 = { _id: 'a2', tenantId: t, campaignId: c, creatorId: 'cr1', account: { platform: 'tiktok', username: 'eka.two', followers: 20 } }

// Submission baru milik baris tertentu; submission lama (tanpa applicationId) ikut lewat creator
assert.equal(submissionBelongsTo({ applicationId: 'a1', creatorId: 'cr1' }, acc1), true)
assert.equal(submissionBelongsTo({ applicationId: 'a1', creatorId: 'cr1' }, acc2), false)
assert.equal(submissionBelongsTo({ creatorId: 'cr1' }, legacy), true)

// Baris buzzer cuma menampilkan akunnya sendiri; baris biasa tidak diubah
const creator = { name: 'Eka', socials: [{ platform: 'tiktok', username: 'eka.one' }, { platform: 'instagram', username: 'eka.ig' }] }
assert.deepEqual(creatorViewFor(creator, acc2)!.socials, [acc2.account])
assert.equal(creatorViewFor(creator, legacy), creator)
assert.equal(creatorViewFor(null, acc1), null)

// Snapshot ekstensi dipakai di baris buzzer cuma kalau username-nya sama
assert.equal(snapshotMatches({ username: '@eka.one' }, acc1), true)
assert.equal(snapshotMatches({ username: 'eka.one' }, acc2), false)
assert.equal(snapshotMatches({ username: 'apa saja' }, legacy), true)

// Batas buzzer cuma untuk platform yang dicentang, 0/kosong = bukan buzzer, maks 20
const camp = (platforms: string[], buzzerMax?: Record<string, number>) => ({ criteria: { platforms, buzzerMax } }) as unknown as Parameters<typeof buzzerLimits>[0]
assert.deepEqual(buzzerLimits(camp(['tiktok', 'instagram'], { tiktok: 3, instagram: 4, x: 5 })), { tiktok: 3, instagram: 4 })
assert.equal(buzzerLimits(camp(['tiktok'], { tiktok: 0 })), null)
assert.equal(buzzerLimits(camp(['tiktok'])), null)
assert.deepEqual(buzzerLimits(camp(['tiktok'], { tiktok: 99 })), { tiktok: 20 })
console.log('ok')
