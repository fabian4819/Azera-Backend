/**
 * Skrip sekali-jalan: perbaiki Creator.socials[].profileUrl yang selama ini
 * dibangun form KOL Register tanpa "@" wajib TikTok/Threads (bug di
 * KOLRegister.tsx, sudah diperbaiki di kode — lihat commit 6f2ab23), atau
 * diketik manual dengan format berantakan (huruf besar, tanpa https://,
 * threads.net lama, dobel https://, dst).
 *
 * profileUrl SELALU dibangun ulang dari username — persis logika
 * `platformProfileUrl` di client/CreatorDetail.tsx dan `PROFILE_URL` di
 * extensionAdmin.routes.ts, supaya ketiganya konsisten. Username placeholder
 * ("-", "0", "tidakada", dst — penanda "belum diisi" dari data lama) dilewati
 * apa adanya, TIDAK dijadikan link palsu.
 *
 * Default dry-run — cuma print apa yang AKAN diubah, tidak menulis apa pun.
 *
 *   npx tsx src/scripts/fixSocialProfileUrls.ts            # dry-run (aman)
 *   npx tsx src/scripts/fixSocialProfileUrls.ts --apply    # tulis ke DB
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })
import mongoose from 'mongoose'
import Creator from '../modules/creators/creator.model'

const PLACEHOLDER_HANDLES = new Set([
  '-', '0', 'a', 'na', 'n/a', 'tidakada', 'tidak ada', 'belum ada', 'none', 'null', 'xx',
])

function normalizeHandle(input: string): string {
  let s = (input || '').trim()
  if (/\//.test(s)) {
    s = s.split(/[?#]/)[0].replace(/\/+$/, '')
    const seg = s.split('/').filter(Boolean)
    s = seg[seg.length - 1] || ''
  }
  return s.replace(/^@/, '').trim()
}

// Handle sosmed cuma berisi huruf/angka/titik/underscore/dash. Apa pun di luar itu
// (spasi, kurung, dst — mis. "fxpandu7 (youtube)") tandanya bukan handle asli, biasanya
// data platform lain nyasar ke field ini. Jangan dipakai bikin link, itu bukan "belum diisi"
// tapi "isinya salah" — keduanya sama-sama harus dilewati, bukan dipaksa jadi URL.
function isRealHandle(raw: string): boolean {
  const h = normalizeHandle(raw)
  if (h.length < 2) return false
  if (PLACEHOLDER_HANDLES.has(h.toLowerCase())) return false
  return /^[a-zA-Z0-9._-]+$/.test(h)
}

const PROFILE_URL: Record<string, (h: string) => string> = {
  instagram: (h) => `https://instagram.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  threads: (h) => `https://www.threads.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
}

async function main() {
  const apply = process.argv.includes('--apply')
  await mongoose.connect(process.env.MONGODB_URI as string)
  console.log(`Terhubung ke ${mongoose.connection.name}. Mode: ${apply ? 'APPLY (menulis ke DB)' : 'DRY-RUN (cuma print)'}\n`)

  // withTenant butuh tenantId ATAU _id di filter — { _id: { $exists: true } }
  // lolos guard-nya sekaligus tetap ambil semua tenant (skrip maintenance global).
  const creators = await Creator.find({ _id: { $exists: true } })

  let changed = 0
  let unchanged = 0
  let skippedPlaceholder = 0
  let skippedUnknownPlatform = 0
  let touchedCreators = 0

  for (const creator of creators) {
    let dirty = false
    for (const s of creator.socials) {
      const builder = PROFILE_URL[s.platform]
      if (!builder) { skippedUnknownPlatform++; continue }

      if (!isRealHandle(s.username)) {
        skippedPlaceholder++
        console.log(`  LEWATI (username belum valid) — ${creator.name} · ${s.platform} · username="${s.username}"`)
        continue
      }

      const handle = normalizeHandle(s.username)
      const next = builder(handle)
      if (s.profileUrl === next) { unchanged++; continue }

      console.log(
        `  ${apply ? 'DIPERBAIKI' : 'AKAN DIPERBAIKI'} — ${creator.name} · ${s.platform}\n` +
        `    username : "${s.username}"\n` +
        `    sebelum  : "${s.profileUrl || '(kosong)'}"\n` +
        `    sesudah  : "${next}"`
      )
      changed++
      if (apply) { s.profileUrl = next; dirty = true }
    }
    if (dirty) {
      await creator.save()
      touchedCreators++
    }
  }

  console.log('\n=== Ringkasan ===')
  console.log(`Creator diperiksa        : ${creators.length}`)
  console.log(`profileUrl diperbaiki    : ${changed}${apply ? ` (ditulis ke ${touchedCreators} dokumen creator)` : ' (dry-run, belum ditulis)'}`)
  console.log(`Sudah benar, tak disentuh: ${unchanged}`)
  console.log(`Dilewati (username tidak valid): ${skippedPlaceholder} — perlu diperbaiki manual di dashboard`)
  if (skippedUnknownPlatform) console.log(`Dilewati (platform tak dikenal): ${skippedUnknownPlatform}`)
  if (!apply && changed > 0) console.log('\nJalankan ulang dengan flag --apply untuk benar-benar menulis perubahan di atas.')

  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
