/** Cek satu-jalan: `npx tsx src/lib/statusColors.test.ts` */
import assert from 'node:assert'
import { statusColorRules } from './googleSheets'

const rules = statusColorRules([{ title: 'Pendaftar', tableRows: 5, values: [['ID', 'Nama', 'Status'], ['1', 'A', 'Approved']], dropdowns: { 2: ['Pending', 'Approved', 'Rejected'] } }], () => 7)
const words = rules.map((r) => r.addConditionalFormatRule.rule.booleanRule.condition.values[0].userEnteredValue)
// Merah duluan supaya "Belum Lunas" tidak ikut hijau karena mengandung "Lunas"
assert.deepEqual(words, ['Rejected', 'Revisi', 'Belum', 'Approved', 'Lunas', 'Sudah', 'Pending', 'Menunggu'])
assert.deepEqual(rules.map((r) => r.addConditionalFormatRule.index), [0, 1, 2, 3, 4, 5, 6, 7])
assert.deepEqual(rules[0].addConditionalFormatRule.rule.ranges, [{ sheetId: 7, startRowIndex: 1, endRowIndex: 5, startColumnIndex: 2, endColumnIndex: 3 }])
assert.equal(statusColorRules([{ title: 'X', tableRows: 2, values: [['Nama']] }], () => 1).length, 0)
console.log('ok')
