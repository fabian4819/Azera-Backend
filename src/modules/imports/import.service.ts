import ExcelJS from 'exceljs'
import { Readable } from 'stream'

/**
 * AD-28: format row-based diusulkan & di-ACC klien 17 Agu 2026 — satu baris =
 * satu platform per creator per campaign (docs/plan/09-open-questions.md).
 */
export interface ImportRow {
  rowNumber: number
  campaignName: string
  brandName: string
  creatorName: string
  platform: string
  link?: string
  niche?: string
  views?: number
  reach?: number
  likes?: number
  comments?: number
  shares?: number
  saved?: number
  /** ISO date — divalidasi di validateRow */
  postedAt?: string
  /** Fee per creator per campaign — boleh diisi di satu baris saja kalau creator punya >1 platform */
  feeCreator?: number
  feePic?: number
  feeMg?: number
  errors: string[]
}

const VALID_PLATFORMS = ['instagram', 'tiktok', 'threads', 'x']

const COLUMN_ALIASES: Record<string, string> = {
  'nama campaign': 'campaignName',
  campaign: 'campaignName',
  brand: 'brandName',
  'nama brand': 'brandName',
  'nama creator': 'creatorName',
  creator: 'creatorName',
  platform: 'platform',
  'link konten': 'link',
  link: 'link',
  'niche akun': 'niche',
  niche: 'niche',
  views: 'views',
  reach: 'reach',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  saved: 'saved',
  saves: 'saved',
  'tanggal posting': 'postedAt',
  tanggal: 'postedAt',
  'fee creator': 'feeCreator',
  'fee pic': 'feePic',
  'fee mg': 'feeMg',
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && 'text' in (value as object)) return String((value as { text: unknown }).text)
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

/**
 * Angka format lokal ("Rp 1.500.000", "12.345", "1,5") maupun US ("1,500,000").
 * Isi yang tidak bisa dibaca → NaN, supaya validateRow menandainya (bukan hilang diam-diam).
 */
export function cellToNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  let s = cellToString(value).replace(/[^0-9.,-]/g, '')
  if (!s || s === '-') return cellToString(value).replace(/[-\s]/g, '') ? NaN : undefined
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  else s = s.replace(',', '.')
  return Number(s)
}

/** Terima Date dari cell Excel, dd/mm/yyyy (format lokal), atau string ISO */
function cellToDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString()
  const s = cellToString(value)
  if (!s) return undefined
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1])).toISOString()
  return s // divalidasi di validateRow, string invalid jadi error baris
}

/**
 * Dipakai preview DAN confirm — confirm tidak boleh percaya `errors` dari client
 * (bisa dikirim `errors: []` untuk baris yang sebenarnya invalid).
 */
export function validateRow(row: Omit<ImportRow, 'errors' | 'rowNumber'>): string[] {
  const errors: string[] = []
  if (!row.campaignName?.trim()) errors.push('Nama Campaign kosong')
  if (!row.brandName?.trim()) errors.push('Brand kosong')
  if (!row.creatorName?.trim()) errors.push('Nama Creator kosong')
  if (!row.platform) errors.push('Platform kosong')
  else if (!VALID_PLATFORMS.includes(row.platform)) errors.push(`Platform "${row.platform}" tidak dikenali (harus: ${VALID_PLATFORMS.join('/')})`)
  if (row.postedAt && Number.isNaN(Date.parse(row.postedAt))) errors.push(`Tanggal Posting "${row.postedAt}" tidak valid (pakai dd/mm/yyyy)`)
  for (const k of ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'feeCreator', 'feePic', 'feeMg'] as const) {
    const v = row[k]
    if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) errors.push(`${k} harus angka ≥ 0`)
  }
  return errors
}

/** Nama dari spreadsheet dipakai sebagai regex case-insensitive — wajib di-escape ("Brand (ID)", "L'Oréal+") */
export function exactName(name: string): RegExp {
  return new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Aturan klien (24 Sep 2026): 1 file/sheet = 1 campaign = 1 brand. Baris yang nama campaign/brand-nya
 * beda dari baris pertama hampir pasti typo — ditandai error, bukan diam-diam jadi campaign kedua.
 */
export function checkSingleCampaign(rows: ImportRow[]): ImportRow[] {
  const first = rows.find((r) => r.campaignName?.trim() && r.brandName?.trim())
  if (!first) return rows
  for (const r of rows) {
    if (r.campaignName?.trim() && norm(r.campaignName) !== norm(first.campaignName)) r.errors.push(`Campaign "${r.campaignName}" beda dari baris pertama ("${first.campaignName}") — 1 file = 1 campaign`)
    if (r.brandName?.trim() && norm(r.brandName) !== norm(first.brandName)) r.errors.push(`Brand "${r.brandName}" beda dari baris pertama ("${first.brandName}") — 1 file = 1 brand`)
  }
  return rows
}

async function loadWorkbook(buffer: Buffer, filename: string): Promise<{ worksheet: ExcelJS.Worksheet; sheetCount: number }> {
  const workbook = new ExcelJS.Workbook()
  if (filename.toLowerCase().endsWith('.csv')) {
    const stream = Readable.from(buffer)
    const worksheet = await workbook.csv.read(stream)
    return { worksheet, sheetCount: 1 }
  }
  // exceljs's Buffer type defs lag behind Node's current Buffer generics — safe at runtime
  await workbook.xlsx.load(buffer as never)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new Error('Spreadsheet tidak punya sheet')
  return { worksheet, sheetCount: workbook.worksheets.length }
}

export async function parseImportFile(buffer: Buffer, filename: string): Promise<{ rows: ImportRow[]; ignoredHeaders: string[]; sheetCount: number }> {
  const { worksheet, sheetCount } = await loadWorkbook(buffer, filename)

  const headerRow = worksheet.getRow(1)
  const columnMap: Record<number, string> = {}
  const ignoredHeaders: string[] = []
  headerRow.eachCell((cell, colNumber) => {
    const header = cellToString(cell.value).trim()
    const key = header.toLowerCase()
    if (COLUMN_ALIASES[key]) columnMap[colNumber] = COLUMN_ALIASES[key]
    else if (header) ignoredHeaders.push(header)
  })

  const rows: ImportRow[] = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const raw: Record<string, unknown> = {}
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const field = columnMap[colNumber]
      if (field) raw[field] = cell.value
    })
    if (Object.keys(raw).length === 0) return

    // Reach & saved cuma berlaku untuk IG/TikTok (notes klien 17 Agu) — dibiarkan kosong untuk X/Threads, bukan divalidasi
    const parsed = {
      campaignName: cellToString(raw.campaignName),
      brandName: cellToString(raw.brandName),
      creatorName: cellToString(raw.creatorName),
      platform: cellToString(raw.platform).toLowerCase(),
      link: cellToString(raw.link) || undefined,
      niche: cellToString(raw.niche) || undefined,
      views: cellToNumber(raw.views),
      reach: cellToNumber(raw.reach),
      likes: cellToNumber(raw.likes),
      comments: cellToNumber(raw.comments),
      shares: cellToNumber(raw.shares),
      saved: cellToNumber(raw.saved),
      postedAt: cellToDate(raw.postedAt),
      feeCreator: cellToNumber(raw.feeCreator),
      feePic: cellToNumber(raw.feePic),
      feeMg: cellToNumber(raw.feeMg),
    }
    rows.push({ rowNumber, ...parsed, errors: validateRow(parsed) })
  })

  return { rows: checkSingleCampaign(rows), ignoredHeaders, sheetCount }
}
