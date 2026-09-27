/**
 * Skrip sekali-jalan: isi field struktur Portfolio terbaru (revisi "Field Portofolio
 * AZERAKOL.ID", Sep 2026) untuk portfolio lama yang masih pakai format metrics lama.
 *
 * Pemetaan (hanya $set — field lama TIDAK dihapus, jadi kode lama yang masih live aman):
 * - status            → 'published' (data lama memang sudah tayang)
 * - deliverables      → "1× TikTok video + mirroring Instagram Reels per KOL"
 * - scope             → sourcing, briefing, content review, monitoring posting, reporting
 * - platforms         → TikTok + Instagram, kreator = kolCount di tiap platform
 *                       (orang yang sama), postingan = kolCount per platform;
 *                       views/reach/engagement dari metrics lama dibagi 60/40
 *                       (TikTok/IG); metrik tambahan tidak tampil publik
 * - cpv               → metrics.costPerView, tampil publik (sebelumnya memang tampil)
 * Portfolio yang sudah punya platforms dilewati (idempotent).
 *
 *   npx tsx src/scripts/migratePortfolioRevisi.ts            # dry-run (aman)
 *   npx tsx src/scripts/migratePortfolioRevisi.ts --apply    # tulis ke DB
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })
import mongoose from 'mongoose'

const DELIVERABLES = '1× TikTok video + mirroring Instagram Reels per KOL'
const SCOPE = ['sourcing', 'briefing', 'content review', 'monitoring posting', 'reporting']
const SHARE = { tiktok: 0.6, instagram: 0.4 }

/** "4.2M" → 4200000, "178K" → 178000; tidak terbaca → null (kosong ≠ nol) */
export function parseCompact(s?: string): number | null {
  const m = (s || '').replace(/[^\d.KMB]/gi, '').match(/^([\d.]+)([KMB])?$/i)
  if (!m) return null
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1
  return Math.round(Number(m[1]) * mult)
}

const part = (n: number | null, share: number) => (n === null ? null : Math.round(n * share))

async function main() {
  const apply = process.argv.includes('--apply')
  await mongoose.connect(process.env.MONGODB_URI as string)
  console.log(`Terhubung ke ${mongoose.connection.name}. Mode: ${apply ? 'APPLY (menulis ke DB)' : 'DRY-RUN (cuma print)'}\n`)

  const col = mongoose.connection.db!.collection('portfolios')
  const docs = await col.find({ $or: [{ platforms: { $exists: false } }, { platforms: { $size: 0 } }] }).toArray()

  for (const d of docs) {
    const m = d.metrics || {}
    const kol = d.kolCount ?? null
    const views = parseCompact(m.totalImpression)
    const reach = parseCompact(m.accountsReached)
    const engagement = parseCompact(m.totalEngagement)
    const platforms = (Object.keys(SHARE) as (keyof typeof SHARE)[]).map((platform) => ({
      platform,
      creators: kol,
      posts: kol,
      views: part(views, SHARE[platform]),
      reach: part(reach, SHARE[platform]),
      impressions: null,
      engagement: part(engagement, SHARE[platform]),
      er: m.avgEngagementRate || '',
      showExtraPublic: false,
    }))
    const set = {
      status: d.status || 'published',
      deliverables: d.deliverables || DELIVERABLES,
      scope: d.scope?.length ? d.scope : SCOPE,
      platforms,
      cpv: d.cpv || m.costPerView || '',
      cpvPublic: d.cpvPublic ?? !!m.costPerView,
    }
    console.log(`${d.brand}: kreator ${kol}, postingan ${(kol ?? 0) * 2}, views ${platforms.map((p) => `${p.platform}=${p.views}`).join(' ')}, CPV ${set.cpv}`)
    if (apply) await col.updateOne({ _id: d._id }, { $set: set })
  }

  console.log(`\n${docs.length} portfolio ${apply ? 'diperbarui' : 'akan diperbarui'}.`)
  if (!apply && docs.length > 0) console.log('Jalankan ulang dengan flag --apply untuk benar-benar menulis perubahan di atas.')
  await mongoose.disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
