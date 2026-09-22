/**
 * Cek satu-jalan: `npx tsx src/lib/googleSheets.test.ts`
 * Yang dijaga di sini cuma logika murni — yang menyentuh Google diuji dengan
 * menempel link sungguhan, bukan mock yang ikut salah kalau asumsinya salah.
 */
import assert from 'node:assert'
import { parseSpreadsheetId, isMasterSpreadsheet } from './googleSheets'
import { KOL_LISTER_HEADERS, kolListerKey, kolListerRow } from '../modules/extension/extension.service'

const ID = '1Vv7LHY4WmU510bQdjJfZRx4QwVXFpkOBF0Ucu2CKpKU'

// link apa pun yang mungkin ditempel orang dari bilah alamat
assert.strictEqual(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`), ID)
assert.strictEqual(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`), ID)
assert.strictEqual(parseSpreadsheetId(`  ${ID}  `), ID)
assert.strictEqual(parseSpreadsheetId('https://docs.google.com/document/d/' + ID + '/edit'), null)
assert.strictEqual(parseSpreadsheetId('bukan link'), null)
assert.strictEqual(parseSpreadsheetId(''), null)

// regex yang sama dipakai panel ekstensi utk menolak sebelum kirim — kalau dua
// sisi ini berbeda, pengguna dapat "link tidak dikenali" dari sisi yang salah.
const sheetSah = (v: string) =>
  /\/spreadsheets\/d\/[a-zA-Z0-9-_]{20,}/.test(v) || /^[a-zA-Z0-9-_]{20,}$/.test(String(v).trim())
for (const contoh of [`https://docs.google.com/spreadsheets/d/${ID}/edit`, ID, 'bukan link', '']) {
  assert.strictEqual(sheetSah(contoh), parseSpreadsheetId(contoh) !== null, `beda penilaian: ${contoh}`)
}

// master sheet tidak boleh ditulisi lewat field link ekstensi
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'master-sheet-id-yang-panjang-sekali'
assert.strictEqual(isMasterSpreadsheet('master-sheet-id-yang-panjang-sekali'), true)
assert.strictEqual(isMasterSpreadsheet(ID), true) // fallback spreadsheet campaign
assert.strictEqual(isMasterSpreadsheet('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'), false)

// jumlah kolom baris HARUS sama dengan jumlah header, kalau tidak isinya geser
const akun = {
  platform: 'Instagram', username: 'https://instagram.com/@Budi/', name: 'Budi',
  url: 'https://instagram.com/budi', followers: 1000, avg_likes: 50,
  er_percent: 5, er_views_percent: 2, er_basis: 'views', verified: 'ya',
}
const row = kolListerRow(akun)
assert.strictEqual(row.length, KOL_LISTER_HEADERS.length, `${row.length} kolom vs ${KOL_LISTER_HEADERS.length} header`)
assert.strictEqual(kolListerKey(akun), 'instagram:budi')
assert.strictEqual(row[1], 'budi')
assert.strictEqual(row[KOL_LISTER_HEADERS.indexOf('ER %')], 2, 'basis views harus pakai er_views_percent')
assert.strictEqual(row[KOL_LISTER_HEADERS.indexOf('Following')], '', 'angka kosong -> sel kosong, bukan 0')

console.log('ok — googleSheets + baris KOL Lister')
