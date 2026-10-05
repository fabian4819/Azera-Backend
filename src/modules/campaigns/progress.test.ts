/**
 * Cek satu-jalan: `npx tsx src/modules/campaigns/progress.test.ts`
 * Logika murni tabel progress: validasi isi sel, pembacaan sel dari Submission, aturan akses kolom.
 */
import assert from 'node:assert'
import { normalizeCell, CellError } from './progress.service'
import { progressCell, creatorAccess, campaignSheetColumns } from '../../lib/sheetSync.service'
import type { ICampaign, IProgressColumn } from './campaign.model'
import type { IApplication } from '../applications/application.model'
import type { ISubmission } from '../submissions/submission.model'

// --- normalizeCell
assert.strictEqual(normalizeCell('number', '12.500', true), 12500)
assert.strictEqual(normalizeCell('number', '3,5', false), 3.5)
assert.strictEqual(normalizeCell('text', '  ', false), undefined)
assert.strictEqual(normalizeCell('date', '2026-10-05', false), '2026-10-05')
assert.throws(() => normalizeCell('date', '05/10/2026', false), CellError)
assert.throws(() => normalizeCell('link', 'instagram.com/p/x', false), CellError)
assert.throws(() => normalizeCell('number', 'abc', true), CellError)
assert.throws(() => normalizeCell('file', 'x', false), CellError)

// --- progressCell: baca submission terbaru yang tipe+platform-nya cocok
const postIg: IProgressColumn = { id: 'a', label: 'Link Post IG', type: 'text', submission: { type: 'post', platform: 'instagram', field: 'link' }, creatorAccess: 'edit' }
const viewsIg: IProgressColumn = { ...postIg, id: 'b', submission: { type: 'post', platform: 'instagram', field: 'views' } }
const free: IProgressColumn = { id: 'c', label: 'Catatan', type: 'text', creatorAccess: 'view' }
const subs = [
  { type: 'post', platform: 'tiktok', link: 'https://tiktok.com/1' },
  { type: 'post', platform: 'instagram', link: 'https://ig.com/new', parsedInsight: { views: 900 } },
  { type: 'post', platform: 'instagram', link: 'https://ig.com/old' },
] as unknown as ISubmission[]
const app = { progress: { c: 'sudah terima produk' } } as unknown as IApplication
assert.strictEqual(progressCell(postIg, app, subs), 'https://ig.com/new')
assert.strictEqual(progressCell(viewsIg, app, subs), 900)
assert.strictEqual(progressCell(free, app, subs), 'sudah terima produk')
assert.strictEqual(progressCell(postIg, app, []), '')

// --- creatorAccess: default aman (WA tersembunyi), admin bisa buka, 'edit' tidak berlaku utk kolom sistem
const campaign = { customFields: [], progressColumns: [free], columnAccess: new Map([['WhatsApp', 'view'], ['Creator', 'edit']]) } as unknown as ICampaign
const cols = campaignSheetColumns(campaign)
const access = (key: string) => creatorAccess(campaign, cols.find((c) => c.key === key)!)
assert.strictEqual(access('WhatsApp'), 'view')
assert.strictEqual(access('Creator'), 'view')
assert.strictEqual(access('Email'), 'hidden')
assert.strictEqual(access('Status Aplikasi'), 'view')
assert.strictEqual(access('progress:c'), 'view')

console.log('progress.test.ts OK')
