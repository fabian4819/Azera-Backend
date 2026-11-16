/** Cek satu-jalan: `npx tsx src/modules/campaigns/clientSheetMatch.test.ts` */
import assert from 'node:assert'
import { matchClientRows } from './clientSheetMatch'

const candidates = [
  { id: 'a', name: 'Diana Putri', phone: '6281200000001', usernames: ['dianaputrirs', 'Dianaputrirs'] },
  { id: 'b', name: 'Tasya', phone: '6281200000002', usernames: ['acsyalf'] },
  { id: 'c', name: 'Budi', phone: '6281200000003', usernames: ['budi.x'] },
  { id: 'd', name: 'Budi', phone: '6281200000004', usernames: ['budi.y'] },
]
const rows = [
  ['No', 'Nama lengkap', 'Username', 'Link akun tiktok'],
  ['1', 'Diana P', 'x', 'https://www.tiktok.com/@DianaPutriRS?lang=id'],
  ['2', 'Tasya Alifiah', '@acsyalf', ''],
  ['3', 'Orang', 'unknown', '0812-0000-0003'],
  ['4', 'Budi', 'zzz_nope', ''],
  ['5', 'Diana Putri', '', ''],
  [],
]
const r = matchClientRows(rows, candidates)
assert.equal(r.length, 6) // baris kosong dilewati
assert.equal(r[0].id, undefined) // header
assert.deepEqual([r[1].id, r[1].by], ['a', 'username'])
assert.deepEqual([r[2].id, r[2].by], ['b', 'username'])
assert.deepEqual([r[3].id, r[3].by], ['c', 'phone'])
assert.equal(r[4].id, undefined) // nama "Budi" dobel → tidak ditebak
assert.deepEqual([r[5].id, r[5].by], ['a', 'name'])
console.log('ok')
