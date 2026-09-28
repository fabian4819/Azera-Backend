/**
 * Skrip sekali-jalan: pisahkan Creator.source lama ('form' | 'import') ke nilai baru.
 *  - 'form' yang dibuat lewat link apply campaign → 'campaign'. Ciri: Application pertamanya
 *    dibuat ≤ 60 detik setelah creator dibuat (publicCampaign bikin keduanya di request yang sama).
 *  - 'import' yang bukan dari import sheet (phone bukan placeholder `import-…`) → 'extension'.
 *
 * Default dry-run.
 *   npx tsx src/scripts/backfillCreatorSource.ts            # dry-run (aman)
 *   npx tsx src/scripts/backfillCreatorSource.ts --apply    # tulis ke DB
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })
import mongoose from 'mongoose'
import Creator from '../modules/creators/creator.model'
import Application from '../modules/applications/application.model'

async function main() {
  const apply = process.argv.includes('--apply')
  await mongoose.connect(process.env.MONGODB_URI as string)
  console.log(`Terhubung ke ${mongoose.connection.name}. Mode: ${apply ? 'APPLY' : 'DRY-RUN'}\n`)

  const toCampaign: mongoose.Types.ObjectId[] = []
  const toExtension: mongoose.Types.ObjectId[] = []

  // withTenant butuh tenantId ATAU _id di filter
  const creators = await Creator.find({ _id: { $exists: true }, source: { $in: ['form', 'import'] } })
  for (const c of creators) {
    if (c.source === 'import') {
      if (!c.phone.startsWith('import-')) toExtension.push(c._id as mongoose.Types.ObjectId)
      continue
    }
    const first = await Application.findOne({ tenantId: c.tenantId, creatorId: c._id }).sort({ createdAt: 1 })
    if (first && +first.createdAt - +c.createdAt <= 60_000) {
      toCampaign.push(c._id as mongoose.Types.ObjectId)
      console.log(`campaign  ← ${c.name}`)
    }
  }
  console.log(`\n${toCampaign.length} → campaign, ${toExtension.length} → extension`)

  if (apply) {
    await Creator.updateMany({ _id: { $in: toCampaign } }, { source: 'campaign' })
    await Creator.updateMany({ _id: { $in: toExtension } }, { source: 'extension' })
    console.log('Selesai ditulis.')
  }
  await mongoose.disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })
