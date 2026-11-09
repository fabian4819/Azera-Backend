/** Cek satu-jalan: `npx tsx src/modules/finance/parseAmount.test.ts` */
import assert from 'node:assert'
import { parseAmount } from './financeBot.service'

assert.strictEqual(parseAmount('5000000'), 5_000_000)
assert.strictEqual(parseAmount('5.000.000'), 5_000_000)
assert.strictEqual(parseAmount('Rp 2.500.000'), 2_500_000)
assert.strictEqual(parseAmount('5jt'), 5_000_000)
assert.strictEqual(parseAmount('4,5 juta'), 4_500_000)
assert.strictEqual(parseAmount('500rb'), 500_000)
assert.strictEqual(parseAmount('0'), 0)
assert.strictEqual(parseAmount('lima juta'), null)
console.log('parseAmount.test.ts OK')
