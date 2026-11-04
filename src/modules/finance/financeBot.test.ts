/** Cek satu-jalan: `npx tsx src/modules/finance/financeBot.test.ts` */
import assert from 'node:assert'
import { parsePeriod, parsePaidDate } from './financeBot.service'
import { parseShortId } from './invoiceShortId.service'

assert.deepEqual(parsePeriod('oktober 2026'), { from: '2026-10-01', to: '2026-10-31', label: 'Oktober 2026' })
assert.deepEqual(parsePeriod('feb 2028'), { from: '2028-02-01', to: '2028-02-29', label: 'Februari 2028' })
assert.deepEqual(parsePeriod('2026'), { from: '2026-01-01', to: '2026-12-31', label: 'Tahun 2026' })
assert.ok(parsePeriod('')?.from.endsWith('-01'))
assert.equal(parsePeriod('kemarin lusa'), null)
assert.equal(parsePaidDate('3 nov 2026'), '2026-11-03')
assert.equal(parsePaidDate('03/11/2026'), '2026-11-03')
assert.equal(parsePaidDate('2026-11-03'), '2026-11-03')
assert.equal(parsePaidDate('besok pagi'), null)
assert.equal(parseShortId('#12'), 12)
assert.equal(parseShortId('12'), 12)
assert.equal(parseShortId('INV/2026'), null)
console.log('financeBot.test OK')
