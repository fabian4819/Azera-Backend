/**
 * Skrip diagnostik: spreadsheet apa saja yang bisa dijangkau service account.
 *
 *   npx tsx src/scripts/listSharedSheets.ts
 *
 * Baca-saja, tidak mengubah apa pun. Dipakai untuk menjawab "sheet campaign ini
 * sudah di-share belum?" tanpa membuka satu per satu Share dialog-nya.
 *
 * Scope Drive diminta DI SINI saja, bukan di googleSheets.ts, server yang jalan
 * sehari-hari tidak butuh melihat daftar file, dan token dengan hak lebih luas
 * dari yang dipakai adalah hak yang bocor kalau kredensialnya bocor.
 *
 * Butuh Google Drive API aktif di project GCP-nya. Kalau belum, Google membalas
 * dengan link untuk mengaktifkannya, ikuti link itu, tunggu semenit, ulangi.
 */
import dotenv from 'dotenv'
// auth dari @googleapis/sheets + Drive REST langsung, paket `googleapis` (209MB) sengaja tidak dipasang
import { auth as googleAuth } from '@googleapis/sheets'
import { creds } from '../lib/googleSheets'

dotenv.config()

interface DriveFileList {
  nextPageToken?: string
  files?: { id?: string; name?: string; owners?: { emailAddress?: string }[]; modifiedTime?: string }[]
}

async function main() {
  const { email, key, spreadsheetId } = creds()
  if (!email || !key) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY belum diisi di .env')
  console.log(`Service account: ${email}\n`)

  const auth = new googleAuth.JWT({
    email, key,
    scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
  })

  let pageToken: string | undefined
  let n = 0
  do {
    const res = await auth.request<DriveFileList>({
      url: 'https://www.googleapis.com/drive/v3/files',
      params: {
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'nextPageToken, files(id, name, owners(emailAddress), modifiedTime)',
      pageSize: 100,
      pageToken,
      // File milik orang lain yang di-share ke service account tidak muncul tanpa ini.
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      },
    })
    for (const f of res.data.files || []) {
      n++
      const tandai = f.id === spreadsheetId ? '  <- master Creators' : ''
      console.log(`${String(n).padStart(2)}. ${f.name}${tandai}`)
      // Link utuh, bukan ID mentah: ini kolom yang mau ditempel orang ke panel
      // ekstensi, dan menyusun ulang URL-nya dari ID adalah langkah manual yang
      // tidak perlu ada.
      console.log(`    https://docs.google.com/spreadsheets/d/${f.id}/edit`)
      console.log(`    pemilik ${f.owners?.[0]?.emailAddress || '?'} · diubah ${f.modifiedTime?.slice(0, 10)}`)
    }
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)

  if (!n) console.log('(kosong, belum ada spreadsheet yang di-share ke email ini)')
  else console.log(`\n${n} spreadsheet bisa diakses.`)
}

main().catch((err) => {
  console.error('Gagal:', err?.message || err)
  process.exit(1)
})
