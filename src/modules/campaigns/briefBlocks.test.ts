/** Cek satu-jalan: `npx tsx src/modules/campaigns/briefBlocks.test.ts` */
import assert from 'node:assert'
import { publicBriefText, stripPicMgFee } from './briefBlocks'

const brief = '*Nano Torabika | AZERA* ✨\n\n*Benefit:*\n💰 Fee Rp85.000\n- Produk\n\n_fee pic 5k, mg 5k_\n\n*Syarat:*\n- Minfol 1000\n\n*Daftar:*\nhttps://azerakol.id/apply/2256b8'
assert.equal(publicBriefText(brief), '*Nano Torabika | AZERA* ✨\n\n*Syarat:*\n- Minfol 1000\n\n*Daftar:*\nhttps://azerakol.id/apply/2256b8')
assert.equal(publicBriefText('_mg 5k_\n\n*Syarat:*\n- a'), '*Syarat:*\n- a')
assert.equal(publicBriefText(undefined), '')
assert.equal(stripPicMgFee(brief), '*Nano Torabika | AZERA* ✨\n\n*Benefit:*\n💰 Fee Rp85.000\n- Produk\n\n*Syarat:*\n- Minfol 1000\n\n*Daftar:*\nhttps://azerakol.id/apply/2256b8')
console.log('ok')
