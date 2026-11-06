/**
 * Cek satu-jalan: `npx tsx src/modules/imports/import.test.ts`
 */
import assert from 'node:assert'
import ExcelJS from 'exceljs'
import { parseFollowers, normalizePhone, cleanHandle, parseImportFile, validateRow, rowKeys } from './import.service'
import { mergeCreator } from './import.routes'

assert.strictEqual(parseFollowers('43.300'), 43300)
assert.strictEqual(parseFollowers('1,5K'), 1500)
assert.strictEqual(parseFollowers('12rb'), 12000)
assert.strictEqual(parseFollowers(5454), 5454)
assert.strictEqual(parseFollowers(''), undefined)
assert.strictEqual(normalizePhone('089673141820'), '6289673141820')
assert.strictEqual(normalizePhone('89673141820'), '6289673141820')
assert.strictEqual(normalizePhone('+62 812-9488-9389'), '6281294889389')
assert.strictEqual(cleanHandle('astii.np\r'), 'astii.np')
assert.strictEqual(cleanHandle('\r\nsitinurulajizah'), 'sitinurulajizah')
assert.strictEqual(cleanHandle('', 'https://www.tiktok.com/@_ftyaaaaa'), '_ftyaaaaa')

;(async () => {
  // Header seperti sheet klien: tab = niche, "Followers" dobel (IG lalu TikTok), Approval bergeser ke kanan
  const wb = new ExcelJS.Workbook()
  const beauty = wb.addWorksheet('Beauty')
  beauty.addRow(['Duplicate Check IG', 'Duplicate Check Tiktok', 'Nama Lengkap', 'Umur', 'Domisili', 'Jenis Kelamin', 'No WA', 'Username IG', 'Link IG', 'Followers', 'Username TIktok', 'Link Tiktok', 'Followers', 'Approval'])
  beauty.addRow(['1', '1', 'Budi Santoso ', '20', 'Bandung', 'P', '081200001111', 'budi.x\r', 'https://www.instagram.com/budi.x?utm_source=ig', '1.475', 'budi_tt', 'tiktok.com/@budi_tt', '43.300', 'Profil OK'])
  beauty.addRow(['0', '0', 'Tanpa WA', '22', 'Bogor', 'L', '', '', '', '', '', '', '', ''])
  beauty.addRow([])
  const travel = wb.addWorksheet('Travel')
  travel.addRow(['Duplicate Check IG', 'Duplicate Check Tiktok', 'Nama Lengkap', 'Umur', 'Domisili', 'Jenis Kelamin', 'No WA', 'Username IG', 'Link IG', 'Followers', 'Username TIktok', 'Link Tiktok', 'Approval'])
  travel.addRow(['1', '0', 'Budi Santoso', '20', 'Bandung', 'P', '81200001111', 'budi.x', 'https://instagram.com/budi.x', '1500', '', '', '', '', 'Profil OK, Engagement OK'])
  wb.addWorksheet('Catatan').addRow(['catatan bebas'])
  const buf = Buffer.from(await wb.xlsx.writeBuffer())

  const { rows, tabs } = await parseImportFile(buf, 'kurasi.xlsx')
  assert.deepStrictEqual(tabs, [{ name: 'Beauty', rows: 2 }, { name: 'Travel', rows: 1 }]) // tab Catatan dilewati
  const [b, noWa, t] = rows
  assert.strictEqual(b.name, 'Budi Santoso')
  assert.strictEqual(b.phone, '6281200001111')
  assert.strictEqual(b.gender, 'Perempuan')
  assert.deepStrictEqual(b.instagram, { username: 'budi.x', url: 'https://www.instagram.com/budi.x?utm_source=ig', followers: 1475 })
  assert.deepStrictEqual(b.tiktok, { username: 'budi_tt', url: 'https://tiktok.com/@budi_tt', followers: 43300 })
  assert.strictEqual(b.approval, 'Profil OK')
  assert.deepStrictEqual(noWa.errors, ['No WA & username IG/TikTok kosong semua'])
  assert.strictEqual(t.approval, 'Profil OK, Engagement OK') // tertulis di kanan header Approval
  assert.strictEqual(t.tiktok, undefined)

  // Creator yang sama di 2 tab: niche digabung, data lama tidak ditimpa, followers terbaru dipakai
  const merged = mergeCreator(mergeCreator(undefined, b), t)
  assert.deepStrictEqual(merged.niches, ['Beauty', 'Travel'])
  assert.strictEqual(merged.approval, 'Profil OK')
  assert.strictEqual(merged.instagram?.followers, 1500)
  assert.strictEqual(merged.tiktok?.username, 'budi_tt')
  // Tanpa WA tapi punya TikTok: tetap valid, dikenali dari username
  assert.deepStrictEqual(validateRow({ name: 'X', phone: '', tiktok: { username: 'x_tt' } }), [])
  assert.deepStrictEqual(rowKeys({ phone: '', tiktok: { username: 'X_TT' } }), ['tt:x_tt'])
  console.log('import.test.ts OK')
})()
