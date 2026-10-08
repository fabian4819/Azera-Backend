/**
 * Cek satu-jalan: `npx tsx src/modules/campaigns/progress.test.ts`
 * Logika murni tabel progress: validasi isi sel, pembacaan sel dari Submission, aturan akses kolom.
 */
import assert from 'node:assert'
import { normalizeCell, CellError, platformFromLink } from './progress.service'
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
assert.throws(() => normalizeCell('media', 'x', false), CellError)

// --- platformFromLink (kolom Link Posting)
assert.strictEqual(platformFromLink('https://www.instagram.com/reel/abc'), 'instagram')
assert.strictEqual(platformFromLink('https://vt.tiktok.com/xyz'), 'tiktok')
assert.strictEqual(platformFromLink('https://www.threads.net/@a/post/1'), 'threads')
assert.strictEqual(platformFromLink('https://x.com/a/status/1'), 'x')
assert.strictEqual(platformFromLink('https://twitter.com/a/status/1'), 'x')
assert.strictEqual(platformFromLink('https://netflix.com/title/1'), undefined)

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
// Draft / Link Posting / Insight default bisa diisi creator, status & metrik cuma dilihat
assert.strictEqual(access('Draft'), 'edit')
assert.strictEqual(access('Link Posting'), 'edit')
assert.strictEqual(access('Insight'), 'edit')
assert.strictEqual(access('Status Draft'), 'view')
assert.strictEqual(access('Views'), 'view')
const locked = { ...campaign, columnAccess: new Map([['Draft', 'hidden'], ['Status Draft', 'edit']]) } as unknown as ICampaign
assert.strictEqual(creatorAccess(locked, cols.find((c) => c.key === 'Draft')!), 'hidden')
assert.strictEqual(creatorAccess(locked, cols.find((c) => c.key === 'Status Draft')!), 'view')
assert.strictEqual(access('Status Aplikasi'), 'view')
assert.strictEqual(access('progress:c'), 'view')

console.log('progress.test.ts OK')
