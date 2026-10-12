/**
 * Skrip sekali-jalan: AD-adjustment-4 menambah stage-2 approval (client) terpisah dari
 * `status` (stage-1, admin). Tanpa backfill ini, semua Application yang SUDAH 'accepted'
 * (campaign yang lagi jalan di production) langsung hilang dari Campaign Tracker + master
 * sheet karena clientApprovalStatus defaultnya 'pending'. Backfill set clientApprovalStatus
 * = 'accepted' untuk semua yang status-nya sudah 'accepted' SEBELUM perubahan ini di-deploy,
 * jadi cuma approval BARU ke depannya yang butuh persetujuan client juga.
 *
 * Default dry-run.
 *   npx tsx src/scripts/backfillClientApproval.ts            # dry-run (aman)
 *   npx tsx src/scripts/backfillClientApproval.ts --apply    # tulis ke DB
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })
import mongoose from 'mongoose'
import Application from '../modules/applications/application.model'

async function main() {
  const apply = process.argv.includes('--apply')
  await mongoose.connect(process.env.MONGODB_URI as string)
  console.log(`Terhubung ke ${mongoose.connection.name}. Mode: ${apply ? 'APPLY' : 'DRY-RUN'}\n`)

  // withTenant butuh tenantId ATAU _id di filter
  const filter = { _id: { $exists: true }, status: 'accepted', clientApprovalStatus: { $ne: 'accepted' } }
  const count = await Application.countDocuments(filter)
  console.log(`${count} application berstatus 'accepted' perlu di-backfill clientApprovalStatus = 'accepted'.`)

  if (apply) {
    await Application.updateMany(filter, { $set: { clientApprovalStatus: 'accepted' } })
    console.log('Selesai ditulis.')
  }
  await mongoose.disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })
