/** Cek satu-jalan: `npx tsx src/modules/topCreators/topCreator.test.ts` */
import assert from 'node:assert'
import { metric } from './topCreator.routes'

for (const [input, want] of [['18000', 18000], ['199.442', 199442], ['6.4K', 6400], ['6,4 k', 6400], ['1,2 jt', 1_200_000], ['12rb', 12000], ['', undefined], ['-', undefined], [undefined, undefined]] as const) {
  assert.equal(metric(input), want, String(input))
}
console.log('ok')
