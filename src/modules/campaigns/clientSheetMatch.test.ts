/** Cek satu-jalan: `npx tsx src/modules/campaigns/clientSheetMatch.test.ts` */
import assert from 'node:assert'
import { matchClientRows } from './clientSheetMatch'

const candidates = [
  { id: 'a', name: 'Diana Putri', phone: '6281200000001', usernames: ['dianaputrirs', 'Dianaputrirs'] },
  { id: 'b', name: 'Tasya', phone: '6281200000002', usernames: ['acsyalf'] },
  { id: 'c', name: 'Budi', phone: '6281200000003', usernames: ['budi.x'] },
  { id: 'd', name: 'Budi', phone: '6281200000004', usernames: ['budi.y'] },
  // buzzer: satu orang dua baris akun, nomor sama
  { id: 'e1', name: 'Eka', phone: '6281200000005', usernames: ['eka.one'] },
  { id: 'e2', name: 'Eka', phone: '6281200000005', usernames: ['eka.two'] },
]
const rows = [
  ['No', 'Nama lengkap', 'Username', 'Link akun tiktok'],
  ['1', 'Diana P', 'x', 'https://www.tiktok.com/@DianaPutriRS?lang=id'],
  ['2', 'Tasya Alifiah', '@acsyalf', ''],
  ['3', 'Orang', 'unknown', '0812-0000-0003'],
  ['4', 'Budi', 'zzz_nope', ''],
  ['5', 'Diana Putri', '', ''],
  [],
  ['6', 'Eka', '@eka.two', '081200000005'],
  ['7', 'Eka', '', '081200000005'],
]
const r = matchClientRows(rows, candidates)
assert.equal(r.length, 8) // baris kosong dilewati
assert.equal(r[0].id, undefined) // header
assert.deepEqual([r[1].id, r[1].by], ['a', 'username'])
assert.deepEqual([r[2].id, r[2].by], ['b', 'username'])
assert.deepEqual([r[3].id, r[3].by], ['c', 'phone'])
assert.equal(r[4].id, undefined) // nama "Budi" dobel → tidak ditebak
assert.deepEqual([r[5].id, r[5].by], ['a', 'name'])
assert.deepEqual([r[6].id, r[6].by], ['e2', 'username'])
assert.equal(r[7].id, undefined) // nomor dipakai 2 baris akun → tidak ditebak
console.log('ok')
