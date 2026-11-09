/** Cek satu-jalan: `npx tsx src/modules/whatsapp/waAdmin.test.ts` */
import assert from 'node:assert'
import { adminBotId, isAdminBotId } from '../../lib/baileys'

const id = adminBotId('6aed583598472c94d0e9e894', 'primary')
assert.strictEqual(id, 'admin-6aed583598472c94d0e9e894-primary')
assert.ok(isAdminBotId(id))
assert.ok(isAdminBotId('admin-6aed583598472c94d0e9e894-backup'))
// Bot bawaan & isian aneh bukan sesi admin (tidak boleh jadi folder auth / pengirim)
for (const bad of ['creator', 'partnership', 'admin-xyz-primary', 'admin-6aed583598472c94d0e9e894-other', '../admin-6aed583598472c94d0e9e894-primary']) assert.ok(!isAdminBotId(bad), bad)
console.log('waAdmin.test.ts OK')
process.exit(0)
