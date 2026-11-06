import { Router, Response } from 'express'
import { Types } from 'mongoose'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import { uploadSpreadsheet } from '../../middleware/upload'
import { parseImportFile, fetchPublicSheetXlsx, ImportInputError, ImportRow, ImportSocial, rowKeys } from './import.service'
import ExistingCreator, { IExistingCreator } from '../existingCreators/existingCreator.model'

const router = Router()
router.use(requireAuth, requireRole('owner', 'admin'))

// Preview cuma kirim sebagian baris ke browser (sheet klien ±10 ribu baris); hitungan & error tetap lengkap
const PREVIEW_ROWS = 300

async function readSource(req: AuthRequest) {
  const link = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
  if (!req.file && !link) throw new ImportInputError('Upload file atau isi link Google Sheets')
  return req.file
    ? parseImportFile(req.file.buffer, req.file.originalname)
    : parseImportFile(await fetchPublicSheetXlsx(link), 'sheet.xlsx')
}

function sendError(res: Response, err: unknown, fallback: string) {
  if (err instanceof ImportInputError) { res.status(400).json({ message: err.message }); return }
  res.status(500).json({ message: fallback, error: (err as Error).message })
}

type Merged = { _id?: Types.ObjectId } & Pick<IExistingCreator, 'name' | 'niches'> & Partial<Pick<IExistingCreator, 'phone' | 'age' | 'domicile' | 'gender' | 'approval' | 'instagram' | 'tiktok'>>

const mergeSocial = (cur: ImportSocial | undefined, next: ImportSocial | undefined): ImportSocial | undefined => {
  if (!next) return cur
  return {
    username: cur?.username || next.username,
    url: cur?.url || next.url,
    // Followers berubah dari waktu ke waktu: angka terbaru dari sheet yang dipakai
    followers: next.followers ?? cur?.followers,
  }
}

/**
 * "Lengkapi data" (keputusan klien): creator yang No WA-nya sudah ada tidak ditimpa, cuma ditambah
 * niche & akun sosmed, field yang masih kosong diisi, followers diperbarui. Dipakai juga untuk creator
 * yang muncul di beberapa tab (niche) dalam satu file.
 */
export function mergeCreator(cur: Merged | undefined, row: ImportRow): Merged {
  return {
    _id: cur?._id,
    name: cur?.name || row.name,
    phone: cur?.phone || row.phone || undefined,
    niches: [...new Set([...(cur?.niches || []), row.tab].filter(Boolean))],
    age: cur?.age ?? row.age,
    domicile: cur?.domicile || row.domicile,
    gender: cur?.gender || row.gender,
    approval: cur?.approval || row.approval,
    instagram: mergeSocial(cur?.instagram, row.instagram),
    tiktok: mergeSocial(cur?.tiktok, row.tiktok),
  }
}

router.post('/preview', uploadSpreadsheet.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const { rows, ignoredHeaders, tabs } = await readSource(req)
    const invalid = rows.filter((r) => r.errors.length)
    const valid = rows.filter((r) => !r.errors.length)
    res.json({
      // Baris bermasalah selalu ikut dikirim supaya bisa dicek, sisanya contoh dari atas
      rows: [...invalid.slice(0, PREVIEW_ROWS), ...valid.slice(0, PREVIEW_ROWS)],
      total: rows.length, validCount: valid.length, invalidCount: invalid.length,
      noPhone: valid.filter((r) => !r.phone).length, ignoredHeaders, tabs,
    })
  } catch (err) { sendError(res, err, 'Gagal membaca file') }
})

// Konfirmasi membaca ulang sumber yang sama (file/link), bukan menerima ribuan baris dari browser
router.post('/confirm', uploadSpreadsheet.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tenantId = new Types.ObjectId(String(req.auth!.tenantId))
    const { rows } = await readSource(req)
    const skipped = rows.filter((r) => r.errors.length).map((r) => ({ rowNumber: r.rowNumber, tab: r.tab, reason: r.errors.join('; ') }))
    const valid = rows.filter((r) => !r.errors.length)

    // Cocokkan ke data yang sudah ada lewat No WA ATAU username IG/TikTok; baris di beberapa tab = 1 creator
    const keys = [...new Set(valid.flatMap(rowKeys))]
    const phones = keys.filter((k) => k.startsWith('wa:')).map((k) => k.slice(3))
    const handles = keys.filter((k) => !k.startsWith('wa:'))
    const existing = await ExistingCreator.find({ tenantId, $or: [{ phone: { $in: phones } }, { handles: { $in: handles } }] }).lean()
    const index = new Map<string, Merged>()
    const records = new Set<Merged>()
    const put = (m: Merged) => { records.add(m); for (const k of rowKeys(m)) index.set(k, m) }
    existing.forEach((e) => put(e as unknown as Merged))
    for (const row of valid) {
      const cur = rowKeys(row).map((k) => index.get(k)).find(Boolean)
      const next = mergeCreator(cur, row)
      if (cur) records.delete(cur)
      put(next)
    }

    const docOf = (m: Merged) => ({
      tenantId, name: m.name, phone: m.phone, niches: m.niches, age: m.age, domicile: m.domicile, gender: m.gender,
      approval: m.approval, instagram: m.instagram, tiktok: m.tiktok, handles: rowKeys(m).filter((k) => !k.startsWith('wa:')),
    })
    const all = [...records]
    const ops = all.map((m) => (m._id
      ? { updateOne: { filter: { _id: m._id }, update: { $set: docOf(m) } } }
      : { insertOne: { document: docOf(m) } }))
    for (let i = 0; i < ops.length; i += 1000) await ExistingCreator.bulkWrite(ops.slice(i, i + 1000) as never, { ordered: false })

    const created = all.filter((m) => !m._id).length
    const updated = all.length - created
    res.json({ created, updated, rows: valid.length, skipped })
  } catch (err) { sendError(res, err, 'Gagal import data') }
})

export default router
