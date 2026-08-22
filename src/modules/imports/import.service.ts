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
  postedAt?: string
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
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && 'text' in (value as object)) return String((value as { text: unknown }).text)
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

function cellToNumber(value: unknown): number | undefined {
  const s = cellToString(value)
  if (!s) return undefined
  const n = Number(s.replace(/[^0-9.-]/g, ''))
  return Number.isNaN(n) ? undefined : n
}

async function loadWorkbook(buffer: Buffer, filename: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook()
  if (filename.toLowerCase().endsWith('.csv')) {
    const stream = Readable.from(buffer)
    const worksheet = await workbook.csv.read(stream)
    return worksheet
  }
  // exceljs's Buffer type defs lag behind Node's current Buffer generics — safe at runtime
  await workbook.xlsx.load(buffer as never)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new Error('Spreadsheet tidak punya sheet')
  return worksheet
}

export async function parseImportFile(buffer: Buffer, filename: string): Promise<ImportRow[]> {
  const worksheet = await loadWorkbook(buffer, filename)

  const headerRow = worksheet.getRow(1)
  const columnMap: Record<number, string> = {}
  headerRow.eachCell((cell, colNumber) => {
    const key = cellToString(cell.value).toLowerCase().trim()
    if (COLUMN_ALIASES[key]) columnMap[colNumber] = COLUMN_ALIASES[key]
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

    const errors: string[] = []
    const campaignName = cellToString(raw.campaignName)
    const brandName = cellToString(raw.brandName)
    const creatorName = cellToString(raw.creatorName)
    const platform = cellToString(raw.platform).toLowerCase()

    if (!campaignName) errors.push('Nama Campaign kosong')
    if (!brandName) errors.push('Brand kosong')
    if (!creatorName) errors.push('Nama Creator kosong')
    if (!platform) errors.push('Platform kosong')
    else if (!VALID_PLATFORMS.includes(platform)) errors.push(`Platform "${platform}" tidak dikenali (harus: ${VALID_PLATFORMS.join('/')})`)

    // Reach & saved cuma berlaku untuk IG/TikTok (notes klien 17 Agu) — bukan wajib divalidasi tapi info aja
    rows.push({
      rowNumber,
      campaignName, brandName, creatorName, platform,
      link: cellToString(raw.link) || undefined,
      niche: cellToString(raw.niche) || undefined,
      views: cellToNumber(raw.views),
      reach: cellToNumber(raw.reach),
      likes: cellToNumber(raw.likes),
      comments: cellToNumber(raw.comments),
      shares: cellToNumber(raw.shares),
      saved: cellToNumber(raw.saved),
      postedAt: cellToString(raw.postedAt) || undefined,
      errors,
    })
  })

  return rows
}
