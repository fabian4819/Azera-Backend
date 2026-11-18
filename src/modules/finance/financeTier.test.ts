/** Cek satu-jalan: `npx tsx src/modules/finance/financeTier.test.ts` */
import assert from 'node:assert'
import { financeFeeFor } from './financeTier'

for (const [n, fee] of [[0, 0], [1, 20_000], [49, 20_000], [50, 40_000], [100, 40_000], [101, 75_000], [500, 75_000], [501, 150_000],
  [1000, 150_000], [1001, 200_000], [2000, 200_000], [2001, 250_000], [3000, 250_000], [3001, 300_000], [99999, 300_000]] as const) {
  assert.equal(financeFeeFor(n), fee, `talent ${n}`)
}
console.log('ok')
