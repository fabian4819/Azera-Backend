import assert from 'node:assert'
import { splitTier } from './financeRecap.routes'

const t = (n: string, d = '', tier = '') => splitTier(n, d, tier)
assert.deepStrictEqual(t('Extrajoss Comment Threads — Buzzer', '1x Reply + Like'), { item: 'Extrajoss Comment Threads', sow: '1x Reply + Like', tier: 'Buzzer' })
assert.deepStrictEqual(t('Extrajoss Bola Timnas — Clipper', '1x Video Tiktok Clipper'), { item: 'Extrajoss Bola Timnas', sow: '1x Video Tiktok Clipper', tier: 'Clipper' })
assert.deepStrictEqual(t('Pigeon Oktober Nano', '1x VT + Reels + IGS'), { item: 'Pigeon Oktober', sow: '1x VT + Reels + IGS', tier: 'Nano' })
assert.deepStrictEqual(t('Philips Comment', 'Buzzer - 1x Comment'), { item: 'Philips Comment', sow: '1x Comment', tier: 'Buzzer' })
assert.deepStrictEqual(t('Philips Comment - Buzzer - 1x Comment'), { item: 'Philips Comment', sow: '1x Comment', tier: 'Buzzer' })
// Platform bukan tier, tier yang diisi di invoice tetap menang, nama cuma tier tidak dipotong
assert.deepStrictEqual(t('Philips Bandung — Tiktok', '1x VISIT + 1x VT'), { item: 'Philips Bandung — Tiktok', sow: '1x VISIT + 1x VT', tier: '' })
assert.deepStrictEqual(t('KOL Lychee', 'Campaign KOL', 'Micro'), { item: 'KOL Lychee', sow: 'Campaign KOL', tier: 'Micro' })
assert.deepStrictEqual(t('Buzzer', '1x Comment'), { item: 'Buzzer', sow: '1x Comment', tier: '' })
assert.deepStrictEqual(t('Reimburse KOL', 'Reimburse'), { item: 'Reimburse KOL', sow: 'Reimburse', tier: '' })
console.log('splitTier.test.ts OK')
