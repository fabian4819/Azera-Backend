// Paket Sheets saja (<1MB), BUKAN `googleapis` (209MB, berisi klien ratusan API Google yang tidak dipakai)
import { auth as googleAuth, sheets, sheets_v4 } from '@googleapis/sheets'

/**
 * Sync satu arah (database → Sheet) real-time, dipanggil fire-and-forget dari route
 * setiap kali Creator/Application/Submission dibuat/diubah, sama seperti pola
 * `sendEmail(...).catch(...)` yang sudah dipakai di modul lain. Kalau kredensial belum
 * di-setup (env kosong), semua fungsi di sini jadi no-op diam-diam, supaya dev/deploy
 * tanpa kredensial Google tidak ikut rusak.
 *
 * Creator dan campaign memakai dua spreadsheet tetap: GOOGLE_SHEETS_SPREADSHEET_ID untuk tab
 * "Creators", dan GOOGLE_SHEETS_CAMPAIGN_SPREADSHEET_ID untuk satu tab gabungan per campaign.
 * BUKAN file terpisah per campaign, service account non-Workspace (akun Google
 * gratis) punya kuota storage Drive 0, jadi tidak bisa bikin FILE baru sama sekali (dicoba & gagal
 * dgn "storage quota exceeded" walau file diletakkan di folder yang di-share), tapi MENAMBAH TAB
 * ke file yang sudah ada (dan sudah di-share Editor ke service account) tidak kena batasan itu.
 *
 * Setup: docs/superpowers/specs/2026-09-15-google-sheets-sync-design.md
 */

// SENGAJA fungsi, BUKAN const top-level, const top-level dievaluasi saat modul ini di-load,
// yang bisa kejadian SEBELUM dotenv.config() di index.ts sempat jalan (urutan resolusi modul,
// bukan urutan baris kode yang kelihatan). Ini persis alasan config/env.ts pakai `get mongodbUri()`
// (getter), bukan const biasa, untuk env var yang sama-sama krusial. Dibaca ulang tiap dipanggil.
export function creds() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  // Private key di .env biasanya satu baris dengan literal "\n", perlu diganti ke newline asli
  // (JWT signing gagal diam-diam/berisik kalau formatnya masih literal \n, bukan newline sungguhan).
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  return { spreadsheetId, email, key }
}

function sheetsEnabled(): boolean {
  const { email, key } = creds()
  return !!(email && key)
}

let sheetsClient: sheets_v4.Sheets | null = null
let auth: InstanceType<typeof googleAuth.JWT> | null = null

export function getSheetsClient(): sheets_v4.Sheets | null {
  if (!sheetsEnabled()) return null
  if (!auth) {
    const { email, key } = creds()
    auth = new googleAuth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'] })
  }
  if (!sheetsClient) sheetsClient = sheets({ version: 'v4', auth })
  return sheetsClient
}

// Google tab name: max 100 char, tidak boleh [ ] * ? / \ :, campaign apa saja bisa jadi nama tab aman.
export function campaignTabPrefix(campaignName: string): string {
  return campaignName.replace(/[[\]*?/\\:]/g, ' ').trim().slice(0, 80)
}

// Tab yang sudah dipastikan ada + punya header, dicek sekali per (spreadsheet, tab), bukan
// tiap panggilan (hemat 1-2 API call per sync, tab tidak akan hilang sendiri selama proses jalan).
const ensuredTabs = new Set<string>()

async function ensureTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
  headers: string[],
  keyHeader: string = 'ID',
  strict: boolean = false
): Promise<void> {
  // Header ikut jadi bagian key: kolom campaign bisa berubah (form kustom / kolom progress),
  // jadi baris header harus ditulis ulang begitu susunannya beda, bukan cuma sekali per proses.
  const key = `${spreadsheetId}:${tab}:${headers.join('\u0001')}`
  if (ensuredTabs.has(key)) return
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const existing = meta.data.sheets?.find((s) => s.properties?.title === tab)
  // Di spreadsheet milik orang lain (jalur ekstensi), tab dengan nama yang sama
  // bisa saja sudah dipakai untuk hal lain, dan `values.update` di bawah menimpa
  // baris 1-nya tanpa tanya. Di mode strict: header asing = berhenti, jangan
  // sentuh apa pun. Tab kosong/baru tetap boleh, itu memang milik kita.
  if (strict && existing) {
    const baris1 = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!1:1` })
    const a1 = baris1.data.values?.[0]?.[0]
    if (a1 && a1 !== keyHeader) {
      throw new Error(`Tab "${tab}" di spreadsheet itu sudah dipakai untuk data lain. Ganti nama tab itu dulu, atau pakai spreadsheet lain.`)
    }
  }
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
 * ponytail: baca-lalu-tulis ini bukan atomik (race kalau 2 sync utk ID sama nyaris bersamaan),
 * risiko rendah untuk data campaign/creator yang jarang berubah sub-detik, tidak ditambah locking. */
async function upsertRow(
  spreadsheetId: string | undefined,
  tab: string,
  headers: string[],
  id: string,
  row: (string | number)[],
  opts: { keyHeader?: string; valueInputOption?: 'RAW' | 'USER_ENTERED'; strict?: boolean } = {}
): Promise<void> {
  const sheets = getSheetsClient()
  if (!sheets || !spreadsheetId) {
    // Sync internal memang no-op diam-diam tanpa kredensial. Tapi kalau seseorang
    // menempel link spreadsheet dan menekan Kirim, diam = dia mengira tercatat.
    if (opts.strict) throw new Error('Sync Google Sheets belum dikonfigurasi di server AzeraKOL.')
    return
  }
  const valueInputOption = opts.valueInputOption ?? 'RAW'
  try {
    await ensureTab(sheets, spreadsheetId, tab, headers, opts.keyHeader, opts.strict)
    const col = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A2:A` })
    const ids = (col.data.values || []).map((r) => r[0])
    const idx = ids.indexOf(id)
    // USER_ENTERED bikin Sheets otomatis parse angka/tanggal/formula (perlu utk HYPERLINK() dan
    // kolom tanggal beneran), tapi itu artinya string digit-only (no. HP/NPWP/rekening) bisa
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
    if (opts.strict) throw new Error(pesanGoogle(err))
    console.error(`Sheets sync error [${tab}]:`, (err as Error).message)
  }
}

/** Error Google -> satu kalimat yang menyebut langkah berikutnya, bukan kode HTTP.
 * 403 hampir selalu berarti spreadsheet-nya belum di-share ke service account,
 * itu kegagalan paling sering di jalur ekstensi, jadi emailnya ikut disebut. */
function pesanGoogle(err: unknown): string {
  const e = err as { code?: number | string; message?: string }
  const kode = Number(e?.code)
  const email = creds().email || 'service account AzeraKOL'
  if (kode === 403) {
    return `Spreadsheet itu belum dibagikan ke ${email}. Buka spreadsheet -> Share -> tambahkan email itu sebagai Editor, lalu kirim lagi.`
  }
  if (kode === 404) return 'Spreadsheet tidak ditemukan. Cek linknya, atau filenya sudah dihapus.'
  if (kode === 429) return 'Google sedang membatasi permintaan. Tunggu semenit, lalu kirim lagi.'
  return e?.message || 'Gagal menulis ke spreadsheet.'
}

// Kolom A tab Creators BUKAN 'ID' generik, tapi WhatsApp (key bisnis yang manusia kenali &
// unique per creator, {tenantId,phone} unique index di creator.model.ts), sesuai permintaan
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

// Application + Submission digabung jadi SATU tab per campaign (bukan 2 tab terpisah seperti
// sebelumnya) di spreadsheet KHUSUS campaign (GOOGLE_SHEETS_CAMPAIGN_SPREADSHEET_ID, file beda
// dari spreadsheet Creators), 1 baris per creator/application, sesuai contoh sheet operasional
// tim ("Pigeon Teens": satu tab berisi data creator + tracking submission-nya sekaligus).
// Kolom dasar yang selalu ada. Sync-caller (sheetSync.service.ts) menambah kolom PIC/Partner +
// kolom per Campaign.customFields di belakangnya secara dinamis (beda-beda per campaign), makanya
// upsertCampaignRow sekarang terima headers sebagai parameter, bukan konstanta tetap.
export const CAMPAIGN_HEADERS_BASE = [
  'Creator', 'WhatsApp', 'Status Aplikasi', 'Hasil Kurasi', 'Status Pembayaran', 'Tanggal Daftar',
  'Draft', 'Status Draft', 'Link Posting', 'Status Posting', 'Insight',
  'Views', 'Likes', 'Comments', 'Shares', 'Tanggal Posting',
]

function campaignSpreadsheetId(): string | undefined {
  return process.env.GOOGLE_SHEETS_CAMPAIGN_SPREADSHEET_ID
    || '1Vv7LHY4WmU510bQdjJfZRx4QwVXFpkOBF0Ucu2CKpKU'
}

// USER_ENTERED (bukan RAW), perlu supaya HYPERLINK() di kolom medsos dievaluasi sebagai formula
// (bukan teks literal "=HYPERLINK(...)") dan Tanggal Daftar (ISO yyyy-mm-dd) dikenali Sheets
// sebagai tipe Date beneran, bukan teks.
export function upsertCreatorRow(phone: string, row: (string | number)[]): Promise<void> {
  const { spreadsheetId } = creds()
  return upsertRow(spreadsheetId, 'Creators', CREATOR_HEADERS, phone, row, { keyHeader: CREATOR_KEY_HEADER, valueInputOption: 'USER_ENTERED' })
}

export function upsertCampaignRow(campaignName: string, id: string, row: (string | number)[], headers: string[]): Promise<void> {
  return upsertRow(campaignSpreadsheetId(), campaignTabPrefix(campaignName), headers, id, row, { valueInputOption: 'USER_ENTERED' })
}

/** Hapus baris campaign (kolom A = id application) kalau ada, mis. creator batal di-approve.
 * Tab belum ada / id tidak ketemu = tidak ada yang dihapus. */
export async function deleteCampaignRow(campaignName: string, id: string): Promise<void> {
  const sheets = getSheetsClient()
  const spreadsheetId = campaignSpreadsheetId()
  if (!sheets || !spreadsheetId) return
  const tab = campaignTabPrefix(campaignName)
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId })
    const sheetId = meta.data.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId
    if (sheetId === undefined || sheetId === null) return
    const col = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A2:A` })
    const idx = (col.data.values || []).map((r) => r[0]).indexOf(id)
    if (idx === -1) return
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: idx + 1, endIndex: idx + 2 } } }] },
    })
  } catch (err) {
    console.error(`Sheets delete error [${tab}]:`, (err as Error).message)
  }
}

/** Link ke tab "Creators" di spreadsheet Creators (buat tombol "Buka Sheet" di admin Creators). */
export function getCreatorsTabUrl(): Promise<string | null> {
  const { spreadsheetId } = creds()
  return getTabUrl(spreadsheetId, 'Creators')
}

/** Link ke tab campaign ini di spreadsheet mastersheet campaign (buat tombol "Buka Master Sheet"
 * di CampaignDetail admin & dashboard PIC). */
export function getCampaignTabUrl(campaignName: string): Promise<string | null> {
  return getTabUrl(campaignSpreadsheetId(), campaignTabPrefix(campaignName))
}

/* ---------- spreadsheet per campaign (1 campaign = 1 file, tab per tabel dashboard) ---------- */

/** Shared Drive tempat spreadsheet per campaign dibuat. Harus Shared Drive: service account tidak
 * punya kuota My Drive, file yang dia buat di My Drive biasa gagal. */
const campaignDriveFolderId = () => process.env.GOOGLE_SHEETS_CAMPAIGN_DRIVE_ID || '0AJT4s-GYnzUVUk9PVA'
const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`

/** Buat folder di root Shared Drive campaign (1 folder per campaign). null kalau Sheets belum dikonfigurasi. */
export async function createCampaignFolder(name: string): Promise<string | null> {
  if (!getSheetsClient() || !auth) return null
  const res = await auth.request<{ id: string }>({
    url: 'https://www.googleapis.com/drive/v3/files',
    method: 'POST',
    params: { supportsAllDrives: true, fields: 'id' },
    data: { name, mimeType: 'application/vnd.google-apps.folder', parents: [campaignDriveFolderId()] },
  })
  return res.data.id
}

/** Pindahkan file Drive ke folder lain (dipakai: spreadsheet campaign lama yang dibuat di root Shared Drive). */
export async function moveDriveFile(fileId: string, folderId: string): Promise<void> {
  if (!getSheetsClient() || !auth) return
  const file = await auth.request<{ parents?: string[] }>({
    url: `https://www.googleapis.com/drive/v3/files/${fileId}`, params: { supportsAllDrives: true, fields: 'parents' },
  })
  await auth.request({
    url: `https://www.googleapis.com/drive/v3/files/${fileId}`,
    method: 'PATCH',
    params: { supportsAllDrives: true, addParents: folderId, removeParents: (file.data.parents || []).join(','), fields: 'id' },
  })
}

/** Buat spreadsheet baru di folder Drive ini dengan tab-tab ini (urut). null kalau Sheets belum dikonfigurasi. */
export async function createCampaignWorkbook(title: string, tabs: string[], folderId: string): Promise<string | null> {
  const sheets = getSheetsClient()
  if (!sheets || !auth) return null
  const res = await auth.request<{ id: string }>({
    url: 'https://www.googleapis.com/drive/v3/files',
    method: 'POST',
    params: { supportsAllDrives: true, fields: 'id' },
    data: { name: title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folderId] },
  })
  const spreadsheetId = res.data.id
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.sheetId' })
  const firstId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { updateSheetProperties: { properties: { sheetId: firstId, title: tabs[0], gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } },
        ...tabs.slice(1).map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })),
      ],
    },
  })
  return spreadsheetId
}

/** Tulis ulang isi tab-tab spreadsheet campaign (tab yang belum ada dibuat). Ditulis ulang utuh, bukan
 * upsert per baris: isi = tabel dashboard, kolom bisa berubah (form kustom / kolom progress).
 * ponytail: clear lalu tulis bukan atomik; pembuka sheet di detik yang sama bisa lihat tab kosong sesaat. */
// Nama kolom tabel harus unik & tidak kosong (dua pertanyaan form bisa berjudul sama)
function uniqueNames(headers: (string | number)[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((h, i) => {
    const base = String(h).trim() || `Kolom ${i + 1}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
}

export async function writeWorkbookTabs(spreadsheetId: string, tabs: { title: string; values: (string | number)[][]; tableRows: number }[]): Promise<void> {
  const sheets = getSheetsClient()
  if (!sheets) return
  const sheetMeta = async () => (await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(title,sheetId),tables(tableId))' })).data.sheets || []
  let meta = await sheetMeta()
  const missing = tabs.filter((t) => !meta.some((sh) => sh.properties?.title === t.title))
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map((t) => ({ addSheet: { properties: { title: t.title, gridProperties: { frozenRowCount: 1 } } } })) },
    })
    meta = await sheetMeta()
  }
  // Tabel Google Sheets (Format > Convert to table) ikut ukuran data, jadi tiap sync: buang tabel lama,
  // tulis ulang isi, buat tabel baru. Format tabel gagal tidak boleh menggagalkan isi data.
  const oldTables = meta.flatMap((sh) => (tabs.some((t) => t.title === sh.properties?.title) ? sh.tables || [] : []))
  if (oldTables.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: oldTables.map((t) => ({ deleteTable: { tableId: t.tableId } })) } })
      .catch((err) => console.error('Sheets deleteTable error:', (err as Error).message))
  }
  await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: tabs.map((t) => quoteTab(t.title)) } })
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data: tabs.map((t) => ({ range: `${quoteTab(t.title)}!A1`, values: t.values })) },
  })
  const addTables = tabs.flatMap((t) => {
    const sheetId = meta.find((sh) => sh.properties?.title === t.title)?.properties?.sheetId
    const headers = t.values[0] || []
    if (sheetId == null || !headers.length) return []
    return [{
      addTable: {
        table: {
          name: t.title,
          // Tabel minimal header + 1 baris; baris total (Report/Recap) sengaja di luar tabel, tepat di bawahnya
          range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(t.tableRows, 2), startColumnIndex: 0, endColumnIndex: headers.length },
          columnProperties: uniqueNames(headers).map((columnName, columnIndex) => ({ columnIndex, columnName })),
        },
      },
    }]
  })
  if (addTables.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: addTables } })
      .catch((err) => console.error('Sheets addTable error:', (err as Error).message))
  }
}

export function getWorkbookTabUrl(spreadsheetId: string, tab: string): Promise<string | null> {
  return getTabUrl(spreadsheetId, tab)
}

/** Link ke tab spesifik di sebuah spreadsheet. Kalau tab belum pernah disync (belum ada baris),
 * balikin link ke spreadsheet tanpa #gid, tab-nya baru dibuat begitu ada data pertama yang
 * di-sync (lihat ensureTab di atas). */
async function getTabUrl(spreadsheetId: string | undefined, tab: string): Promise<string | null> {
  if (!spreadsheetId) return null
  const baseUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  const sheets = getSheetsClient()
  if (!sheets) return baseUrl
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId })
    const gid = meta.data.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId
    return `${baseUrl}${gid != null ? `#gid=${gid}` : ''}`
  } catch (err) {
    console.error(`Sheets getTabUrl error [${tab}]:`, (err as Error).message)
    return baseUrl
  }
}

/* ---------- spreadsheet milik pengguna (jalur ekstensi KOL Lister) ---------- */

/** Terima link lengkap Google Sheets atau ID mentahnya. Selain itu: null. */
export function parseSpreadsheetId(input: string): string | null {
  const s = String(input || '').trim()
  if (!s) return null
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/)
  if (m) return m[1]
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : null
}

/** Spreadsheet operasional AzeraKOL sendiri. Pemegang token ekstensi tidak boleh
 * menyuruh server menulis ke sana lewat field link, itu jalur untuk sheet campaign
 * milik pengguna, bukan pintu belakang ke master sheet. */
export function isMasterSpreadsheet(id: string): boolean {
  return id === creds().spreadsheetId || id === campaignSpreadsheetId()
}

/**
 * Satu baris ke spreadsheet yang linknya ditempel pengguna. Melempar kalau gagal
 * (beda dari sync internal yang sengaja diam), pengirimnya menunggu jawaban.
 * Balikin link langsung ke tab-nya.
 */
export async function upsertExternalSheetRow(
  spreadsheetId: string,
  tab: string,
  keyHeader: string,
  headers: string[],
  key: string,
  row: (string | number)[]
): Promise<string | null> {
  await upsertRow(spreadsheetId, tab, headers, key, row, {
    keyHeader,
    valueInputOption: 'USER_ENTERED',
    strict: true,
  })
  return getTabUrl(spreadsheetId, tab)
}
