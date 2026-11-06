import ExcelJS from 'exceljs'
import { Readable } from 'stream'
import { parseSpreadsheetId } from '../../lib/googleSheets'

/**
 * Import Data = creator kurasi (yang sudah dipilih & pernah ikut campaign sebelum ada platform), format
 * sheet talent pool klien (Nov 2026): 1 tab = 1 niche (Beauty, Lifestyle, Food, Travel, Mom and Kids),
 * kolom Nama Lengkap, Umur, Domisili, Jenis Kelamin, No WA, Username/Link/Followers IG & TikTok, Approval.
 * Hasilnya masuk menu Existing Creator, bukan Creator umum. Menggantikan format lama per campaign.
 */
export interface ImportSocial { username?: string; url?: string; followers?: number }
export interface ImportRow {
  tab: string
  rowNumber: number
  name: string
  phone: string
  age?: number
  domicile?: string
  gender?: string
  instagram?: ImportSocial
  tiktok?: ImportSocial
  approval?: string
  errors: string[]
}

type Field = 'name' | 'age' | 'domicile' | 'gender' | 'phone' | 'igUsername' | 'igUrl' | 'igFollowers'
  | 'ttUsername' | 'ttUrl' | 'ttFollowers' | 'approval' | 'ignore'

const COLUMN_ALIASES: Record<string, Field> = {
  'nama lengkap': 'name', nama: 'name', 'nama creator': 'name',
  umur: 'age', usia: 'age',
  domisili: 'domicile', kota: 'domicile',
  'jenis kelamin': 'gender', gender: 'gender',
  'no wa': 'phone', 'no. wa': 'phone', 'nomor wa': 'phone', whatsapp: 'phone', 'no whatsapp': 'phone', 'no hp': 'phone',
  'username ig': 'igUsername', 'username instagram': 'igUsername',
  'link ig': 'igUrl', 'link instagram': 'igUrl',
  'followers ig': 'igFollowers', 'followers instagram': 'igFollowers',
  'username tiktok': 'ttUsername', 'link tiktok': 'ttUrl', 'followers tiktok': 'ttFollowers',
  approval: 'approval', 'hasil kurasi': 'approval',
  // Kolom bantu rumus di sheet klien, sengaja diabaikan tanpa peringatan
  'duplicate check ig': 'ignore', 'duplicate check tiktok': 'ignore',
}

export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const v = value as { text?: unknown; richText?: { text: string }[]; result?: unknown }
    if (v.richText) return v.richText.map((r) => r.text).join('').trim()
    if ('text' in v) return cellToString(v.text)
    if ('result' in v) return cellToString(v.result)
  }
  return String(value).trim()
}

/** "43.300", "1,5K", "12rb", "2.1jt", 5454 → angka. Kosong/tidak terbaca → undefined. */
export function parseFollowers(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : undefined
  const s = cellToString(value).toLowerCase().replace(/\s/g, '')
  const m = s.match(/^([\d.,]+)(k|rb|ribu|jt|juta|m)?$/)
  if (!m) return undefined
  const mult = m[2] === 'k' || m[2] === 'rb' || m[2] === 'ribu' ? 1e3 : m[2] ? 1e6 : 1
  // Pakai suffix: koma/titik = desimal ("1,5K"); tanpa suffix: titik/koma = pemisah ribuan ("43.300")
  const n = mult > 1 ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/[.,]/g, ''))
  return Number.isFinite(n) ? Math.round(n * mult) : undefined
}

/** 0812… / 812… / +62 812… → 62812… (format yang dipakai bot WA) */
export function normalizePhone(value: unknown): string {
  const d = cellToString(value).replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('62')) return d
  if (d.startsWith('0')) return `62${d.slice(1)}`
  if (d.startsWith('8')) return `62${d}`
  return d
}

/** Username bersih (tanpa @, spasi/enter, link); kosong → ambil dari link profil */
export function cleanHandle(username: unknown, url?: string): string {
  const u = cellToString(username).replace(/\s/g, '').replace(/^@+/, '')
  if (u && !u.includes('/')) return u
  const src = (u || url || '').replace(/\s/g, '').split(/[?#]/)[0].replace(/\/+$/, '')
  return (src.split('/').pop() || '').replace(/^@+/, '')
}

const cleanUrl = (v: unknown) => {
  const s = cellToString(v).replace(/\s/g, '')
  if (!s) return undefined
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

function genderLabel(v: unknown): string | undefined {
  const s = cellToString(v).toLowerCase()
  if (!s) return undefined
  if (s === 'p' || s.startsWith('perempuan') || s.startsWith('wanita') || s === 'f' || s.startsWith('female')) return 'Perempuan'
  if (s === 'l' || s.startsWith('laki') || s.startsWith('pria') || s === 'm' || s.startsWith('male')) return 'Laki-laki'
  return cellToString(v)
}

/** Kolom per index (1-based). "Followers" tanpa keterangan ikut platform kolom username/link sebelumnya. */
export function mapHeaders(headers: string[]): { columns: Record<number, Field>; ignored: string[] } {
  const columns: Record<number, Field> = {}
  const ignored: string[] = []
  let platform: 'ig' | 'tt' = 'ig'
  headers.forEach((raw, i) => {
    const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key) return
    let field = COLUMN_ALIASES[key]
    if (!field && key === 'followers') field = platform === 'tt' ? 'ttFollowers' : 'igFollowers'
    if (field?.startsWith('tt')) platform = 'tt'
    else if (field?.startsWith('ig')) platform = 'ig'
    if (field) columns[i + 1] = field
    else ignored.push(raw.trim())
  })
  return { columns, ignored }
}

export function validateRow(row: Pick<ImportRow, 'name' | 'phone' | 'instagram' | 'tiktok'>): string[] {
  const errors: string[] = []
  if (!row.name) errors.push('Nama Lengkap kosong')
  if (row.phone && (row.phone.length < 10 || row.phone.length > 15)) errors.push(`No WA "${row.phone}" tidak valid`)
  if (!row.phone && !row.instagram?.username && !row.tiktok?.username) errors.push('No WA & username IG/TikTok kosong semua')
  return errors
}

/** Nama dari input dipakai sebagai regex case-insensitive, wajib di-escape ("Brand (ID)", "L'Oréal+") */
export function exactName(name: string): RegExp {
  return new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
}

export class ImportInputError extends Error {}

const MAX_SHEET_BYTES = 20 * 1024 * 1024

/**
 * Ambil SELURUH workbook Google Sheets ("Anyone with the link") sebagai xlsx, supaya semua tab (= niche)
 * ikut terbaca. Yang dikirim ke Google cuma ID hasil parsing, bukan URL mentah dari user (tidak ada SSRF).
 */
export async function fetchPublicSheetXlsx(link: string): Promise<Buffer> {
  const id = parseSpreadsheetId(link)
  if (!id) throw new ImportInputError('Link Google Sheets tidak valid')
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
  if (res.status === 404) throw new ImportInputError('Spreadsheet tidak ditemukan, cek lagi link-nya')
  if (!res.ok || !res.headers.get('content-type')?.includes('spreadsheetml')) {
    throw new ImportInputError('Sheet belum dibuka untuk umum. Ubah akses ke "Anyone with the link" (Viewer), lalu coba lagi.')
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_SHEET_BYTES) throw new ImportInputError('Sheet terlalu besar (maks 20MB)')
  return buf
}

async function loadWorksheets(buffer: Buffer, filename: string): Promise<ExcelJS.Worksheet[]> {
  const workbook = new ExcelJS.Workbook()
  if (filename.toLowerCase().endsWith('.csv')) {
    // map identitas: nilai CSV tetap string mentah (default exceljs menebak tipe, "43.300" jadi 43.3)
    const ws = await workbook.csv.read(Readable.from(buffer), { map: (value: unknown) => value } as never)
    ws.name = filename.replace(/\.csv$/i, '').slice(0, 31) || 'CSV'
    return [ws]
  }
  // exceljs's Buffer type defs lag behind Node's current Buffer generics, safe at runtime
  await workbook.xlsx.load(buffer as never)
  return workbook.worksheets
}

/** Kunci pencocokan creator: No WA + username IG/TikTok (huruf kecil) */
export const rowKeys = (r: { phone?: string; instagram?: ImportSocial; tiktok?: ImportSocial }): string[] => [
  ...(r.phone ? [`wa:${r.phone}`] : []),
  ...(r.instagram?.username ? [`ig:${r.instagram.username.toLowerCase()}`] : []),
  ...(r.tiktok?.username ? [`tt:${r.tiktok.username.toLowerCase()}`] : []),
]

/** Baca semua tab: tab tanpa kolom Nama & No WA dilewati (mis. tab catatan), nama tab = niche. */
export async function parseImportFile(buffer: Buffer, filename: string): Promise<{ rows: ImportRow[]; ignoredHeaders: string[]; tabs: { name: string; rows: number }[] }> {
  const sheets = await loadWorksheets(buffer, filename)
  const rows: ImportRow[] = []
  const ignoredHeaders = new Set<string>()
  const tabs: { name: string; rows: number }[] = []

  for (const ws of sheets) {
    const headers: string[] = []
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = cellToString(cell.value) })
    const { columns, ignored } = mapHeaders(Array.from(headers, (h) => h ?? ''))
    const fields = Object.values(columns)
    if (!fields.includes('name') || !fields.includes('phone')) continue
    ignored.forEach((h) => ignoredHeaders.add(h))
    const lastCol = Math.max(...Object.keys(columns).map(Number))
    const tab = ws.name.trim()
    let count = 0

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const raw: Partial<Record<Field, unknown>> = {}
      const extra: string[] = []
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        const field = columns[col]
        if (field && field !== 'ignore') raw[field] = cell.value
        else if (col > lastCol && cellToString(cell.value)) extra.push(cellToString(cell.value))
      })
      const name = cellToString(raw.name).replace(/\s+/g, ' ')
      const phone = normalizePhone(raw.phone)
      if (!name && !phone) return // baris kosong / sisa format
      const social = (u: unknown, l: unknown, f: unknown): ImportSocial | undefined => {
        const url = cleanUrl(l)
        const username = cleanHandle(u, url)
        const followers = parseFollowers(f)
        return username || url || followers !== undefined ? { username: username || undefined, url, followers } : undefined
      }
      const parsed = {
        tab, rowNumber, name, phone,
        age: Number(cellToString(raw.age).replace(/\D/g, '')) || undefined,
        domicile: cellToString(raw.domicile).replace(/\s+/g, ' ') || undefined,
        gender: genderLabel(raw.gender),
        instagram: social(raw.igUsername, raw.igUrl, raw.igFollowers),
        tiktok: social(raw.ttUsername, raw.ttUrl, raw.ttFollowers),
        // Approval kadang tertulis bergeser ke kanan header (tab Travel), ambil sel terisi setelah kolom terakhir
        approval: cellToString(raw.approval) || extra.join(', ') || undefined,
      }
      rows.push({ ...parsed, errors: validateRow(parsed) })
      count++
    })
    tabs.push({ name: tab, rows: count })
  }

  if (!tabs.length) {
    throw new ImportInputError('Tidak ada tab dengan kolom yang dikenali. Baris 1 harus berisi header seperti: Nama Lengkap, Umur, Domisili, Jenis Kelamin, No WA, Username IG, Link IG, Followers IG, Username TikTok, Link TikTok, Followers TikTok, Approval.')
  }
  if (!rows.length) throw new ImportInputError('Sheet tidak punya baris data di bawah header')
  return { rows, ignoredHeaders: [...ignoredHeaders], tabs }
}
