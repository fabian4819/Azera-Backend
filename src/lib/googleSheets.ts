import { google, sheets_v4 } from 'googleapis'

/**
 * Sync satu arah (database → Sheet) real-time — dipanggil fire-and-forget dari route
 * setiap kali Creator/Application/Submission dibuat/diubah, sama seperti pola
 * `sendEmail(...).catch(...)` yang sudah dipakai di modul lain. Kalau kredensial belum
 * di-setup (env kosong), semua fungsi di sini jadi no-op diam-diam — supaya dev/deploy
 * tanpa kredensial Google tidak ikut rusak.
 *
 * Semuanya sync ke SATU spreadsheet tetap (GOOGLE_SHEETS_SPREADSHEET_ID, yang sama juga dipakai
 * Creators): tab "Creators", lalu satu tab "{Campaign} - Applications" & "{Campaign} - Submissions"
 * per campaign. BUKAN file terpisah per campaign — service account non-Workspace (akun Google
 * gratis) punya kuota storage Drive 0, jadi tidak bisa bikin FILE baru sama sekali (dicoba & gagal
 * dgn "storage quota exceeded" walau file diletakkan di folder yang di-share) — tapi MENAMBAH TAB
 * ke file yang sudah ada (dan sudah di-share Editor ke service account) tidak kena batasan itu.
 *
 * Setup: docs/superpowers/specs/2026-09-15-google-sheets-sync-design.md
 */

// SENGAJA fungsi, BUKAN const top-level — const top-level dievaluasi saat modul ini di-load,
// yang bisa kejadian SEBELUM dotenv.config() di index.ts sempat jalan (urutan resolusi modul,
// bukan urutan baris kode yang kelihatan). Ini persis alasan config/env.ts pakai `get mongodbUri()`
// (getter), bukan const biasa, untuk env var yang sama-sama krusial. Dibaca ulang tiap dipanggil.
export function creds() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  // Private key di .env biasanya satu baris dengan literal "\n" — perlu diganti ke newline asli
  // (JWT signing gagal diam-diam/berisik kalau formatnya masih literal \n, bukan newline sungguhan).
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  return { spreadsheetId, email, key }
}

function sheetsEnabled(): boolean {
  const { spreadsheetId, email, key } = creds()
  return !!(spreadsheetId && email && key)
}

let sheetsClient: sheets_v4.Sheets | null = null
let auth: InstanceType<typeof google.auth.JWT> | null = null

export function getSheetsClient(): sheets_v4.Sheets | null {
  if (!sheetsEnabled()) return null
  if (!auth) {
    const { email, key } = creds()
    auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  }
  if (!sheetsClient) sheetsClient = google.sheets({ version: 'v4', auth })
  return sheetsClient
}

// Google tab name: max 100 char, tidak boleh [ ] * ? / \ : — campaign apa saja bisa jadi nama tab aman.
export function campaignTabPrefix(campaignName: string): string {
  return campaignName.replace(/[[\]*?/\\:]/g, ' ').trim().slice(0, 80)
}

// Tab yang sudah dipastikan ada + punya header — dicek sekali per (spreadsheet, tab), bukan
// tiap panggilan (hemat 1-2 API call per sync, tab tidak akan hilang sendiri selama proses jalan).
const ensuredTabs = new Set<string>()

async function ensureTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
  headers: string[],
  keyHeader: string = 'ID'
): Promise<void> {
  const key = `${spreadsheetId}:${tab}`
  if (ensuredTabs.has(key)) return
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const existing = meta.data.sheets?.find((s) => s.properties?.title === tab)
  let sheetId = existing?.properties?.sheetId
  if (sheetId === undefined || sheetId === null) {
    const added = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    })
    sheetId = added.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [[keyHeader, ...headers]] },
  })
  // Samakan dengan tab Creators: baris header dibekukan + kolom auto-lebar sesuai isi header.
  if (sheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: headers.length + 1 },
            },
          },
        ],
      },
    }).catch((err) => console.error(`Sheets format error [${tab}]:`, (err as Error).message))
  }
  ensuredTabs.add(key)
}

/** Cari baris existing lewat kolom A (ID) → update kalau ketemu, append kalau belum ada.
 * ponytail: baca-lalu-tulis ini bukan atomik (race kalau 2 sync utk ID sama nyaris bersamaan) —
 * risiko rendah untuk data campaign/creator yang jarang berubah sub-detik, tidak ditambah locking. */
async function upsertRow(
  tab: string,
  headers: string[],
  id: string,
  row: (string | number)[],
  opts: { keyHeader?: string; valueInputOption?: 'RAW' | 'USER_ENTERED' } = {}
): Promise<void> {
  const sheets = getSheetsClient()
  if (!sheets) return
  const { spreadsheetId } = creds()
  const valueInputOption = opts.valueInputOption ?? 'RAW'
  try {
    await ensureTab(sheets, spreadsheetId!, tab, headers, opts.keyHeader)
    const col = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A2:A` })
    const ids = (col.data.values || []).map((r) => r[0])
    const idx = ids.indexOf(id)
    // USER_ENTERED bikin Sheets otomatis parse angka/tanggal/formula (perlu utk HYPERLINK() dan
    // kolom tanggal beneran) — tapi itu artinya string digit-only (no. HP/NPWP/rekening) bisa
    // "dimakan" jadi angka & kehilangan digit 0 di depan. Apostrof di depan maksa tetap teks;
    // apostrofnya sendiri tidak ikut jadi bagian value pas dibaca balik lewat API.
    const guard = (v: string | number) =>
      valueInputOption === 'USER_ENTERED' && typeof v === 'string' && /^\d{4,}$/.test(v) ? `'${v}` : v
    const values = [[guard(id), ...row.map(guard)]]
    if (idx === -1) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tab}!A:A`,
        valueInputOption,
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      })
    } else {
      const rowNumber = idx + 2 // +1 header, +1 karena hasil get dimulai dari A2
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A${rowNumber}`,
        valueInputOption,
        requestBody: { values },
      })
    }
  } catch (err) {
    console.error(`Sheets sync error [${tab}]:`, (err as Error).message)
  }
}

// Kolom A tab Creators BUKAN 'ID' generik, tapi WhatsApp (key bisnis yang manusia kenali &
// unique per creator — {tenantId,phone} unique index di creator.model.ts) — sesuai permintaan
// buang kolom ID mentah dari sheet. CREATOR_HEADERS di bawah TIDAK termasuk WhatsApp karena
// itu sudah jadi kolom A/key, bukan bagian row data.
export const CREATOR_KEY_HEADER = 'WhatsApp'

export const CREATOR_HEADERS = [
  'Nama', 'Email', 'Usia', 'Jenis Kelamin', 'Kota', 'Provinsi',
  'Niche', 'Gaya Konten', 'Aktivitas',
  'Instagram', 'Instagram - Metrik Ekstensi',
  'TikTok', 'TikTok - Metrik Ekstensi',
  'Threads', 'Threads - Metrik Ekstensi',
  'X', 'X - Metrik Ekstensi',
  'Estimasi Rate', 'Rate Bisa Nego',
  'Nama Bank', 'No. Rekening', 'Nama Pemilik Rekening', 'NPWP',
  'Portfolio',
  'Jumlah Cancel', 'Compliance', 'Sumber', 'Status', 'Tanggal Daftar',
]

// Index kolom (0 = kolom A / key WhatsApp) berdasarkan nama header, dipakai skrip setup dropdown
// sekali-jalan supaya index tidak di-hardcode manual dan ikut geser otomatis kalau header berubah.
export function creatorColIndex(header: string): number {
  const idx = CREATOR_HEADERS.indexOf(header)
  if (idx === -1) throw new Error(`Unknown creator header: ${header}`)
  return idx + 1
}

export const APPLICATION_HEADERS = ['Brand', 'Creator', 'Status', 'Hasil Kurasi', 'Status Pembayaran', 'Tanggal']
export const SUBMISSION_HEADERS = ['Creator', 'Tipe', 'Platform', 'Link', 'Status', 'Views', 'Likes', 'Comments', 'Shares', 'Tanggal']

// USER_ENTERED (bukan RAW) — perlu supaya HYPERLINK() di kolom medsos dievaluasi sebagai formula
// (bukan teks literal "=HYPERLINK(...)") dan Tanggal Daftar (ISO yyyy-mm-dd) dikenali Sheets
// sebagai tipe Date beneran, bukan teks.
export function upsertCreatorRow(phone: string, row: (string | number)[]): Promise<void> {
  return upsertRow('Creators', CREATOR_HEADERS, phone, row, { keyHeader: CREATOR_KEY_HEADER, valueInputOption: 'USER_ENTERED' })
}

export function upsertApplicationRow(campaignName: string, id: string, row: (string | number)[]): Promise<void> {
  return upsertRow(`${campaignTabPrefix(campaignName)} - Applications`, APPLICATION_HEADERS, id, row)
}

export function upsertSubmissionRow(campaignName: string, id: string, row: (string | number)[]): Promise<void> {
  return upsertRow(`${campaignTabPrefix(campaignName)} - Submissions`, SUBMISSION_HEADERS, id, row)
}
