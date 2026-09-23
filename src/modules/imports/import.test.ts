/**
 * Cek satu-jalan: `npx tsx src/modules/imports/import.test.ts`
 */
import assert from 'node:assert'
import ExcelJS from 'exceljs'
import { cellToNumber, exactName, parseImportFile, validateRow, checkSingleCampaign } from './import.service'

// Angka format lokal & US, dan isi aneh jadi NaN (ditandai error), bukan hilang diam-diam
assert.strictEqual(cellToNumber('Rp 1.500.000'), 1500000)
assert.strictEqual(cellToNumber('12.345'), 12345)
assert.strictEqual(cellToNumber('1,500,000'), 1500000)
assert.strictEqual(cellToNumber('1,5'), 1.5)
assert.strictEqual(cellToNumber(2500), 2500)
assert.strictEqual(cellToNumber('-'), undefined)
assert.strictEqual(cellToNumber(''), undefined)
assert.ok(Number.isNaN(cellToNumber('N/A')))

// Regex nama di-escape
assert.ok(exactName('Brand (ID)').test('brand (id)'))
assert.ok(!exactName('A.B').test('AxB'))

// Confirm memvalidasi ulang — errors dari client tidak dipercaya
const base = { campaignName: 'C', brandName: 'B', creatorName: 'K', platform: 'instagram' }
assert.deepStrictEqual(validateRow(base), [])
assert.strictEqual(validateRow({ ...base, platform: 'youtube' }).length, 1)
assert.strictEqual(validateRow({ ...base, views: NaN }).length, 1)
assert.strictEqual(validateRow({ ...base, postedAt: 'kemarin' }).length, 1)

// 1 file = 1 campaign = 1 brand: beda kapitalisasi boleh, beda nama ditandai
const mk = (campaignName: string, brandName: string) => ({ rowNumber: 0, campaignName, brandName, creatorName: 'K', platform: 'x', errors: [] as string[] })
const checked = checkSingleCampaign([mk('Ramadan', 'Brand A'), mk('ramadan ', 'brand a'), mk('Ramadhan', 'Brand A'), mk('Ramadan', 'Brand B')])
assert.deepStrictEqual(checked.map((r) => r.errors.length), [0, 0, 1, 1])

async function main() {
  // CSV: nilai harus tetap string mentah — exceljs default mengubah "12.500" jadi 12.5 dan tanggal jadi format US
  const csv = await parseImportFile(Buffer.from('Nama Campaign,Brand,Nama Creator,Platform,Views,Tanggal Posting\nC,B,K,x,12.500,03-04-2026\n'), 'a.csv')
  assert.strictEqual(csv.rows[0].views, 12500)
  assert.strictEqual(csv.rows[0].postedAt, '2026-04-03T00:00:00.000Z')

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Data')
  ws.addRow(['Nama Campaign', 'Brand', 'Nama Creator', 'Platform', 'Views', 'Tanggal Posting', 'Fee Creator', 'Kolom Aneh'])
  ws.addRow(['Ramadan', 'Brand (ID)', 'Sari', 'Instagram', '12.345', '17/08/2026', 'Rp 1.500.000', 'x'])
  ws.addRow(['Ramadan', 'Brand (ID)', 'Sari', 'X', 900, new Date(Date.UTC(2026, 7, 18)), '', ''])
  const { rows, ignoredHeaders, sheetCount } = await parseImportFile(Buffer.from(await wb.xlsx.writeBuffer()), 'a.xlsx')
  assert.deepStrictEqual(ignoredHeaders, ['Kolom Aneh'])
  assert.strictEqual(sheetCount, 1)
  assert.strictEqual(rows[0].views, 12345)
  assert.strictEqual(rows[0].feeCreator, 1500000)
  assert.strictEqual(rows[0].postedAt, '2026-08-17T00:00:00.000Z')
  assert.strictEqual(rows[1].platform, 'x')
  assert.strictEqual(rows[1].postedAt, '2026-08-18T00:00:00.000Z')
  assert.ok(rows.every((r) => r.errors.length === 0), JSON.stringify(rows.map((r) => r.errors)))
  await assert.rejects(parseImportFile(Buffer.from('Foo,Bar\n1,2\n'), 'b.csv'), /Tidak ada kolom yang dikenali/)
  await assert.rejects(parseImportFile(Buffer.from('Nama Campaign,Brand\n'), 'c.csv'), /tidak punya baris data/)
  console.log('import.test.ts OK')
}
main()
