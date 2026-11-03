import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { connectDB } from '../db/connect'
import { sheetHookSecret } from '../lib/sheetHook'
import { applySheetRow, type SheetRow } from '../modules/campaigns/sheetEdit.service'

/** Dipanggil pemicu onEdit Apps Script (scripts/sheet-sync.gs) tiap ada edit di spreadsheet campaign.
 * Publik tapi wajib SHEET_HOOK_SECRET; isi = baris-baris yang diedit lengkap dengan header-nya. */
const router = Router()

const secretOk = (given: unknown) => {
  const expected = sheetHookSecret()
  if (!expected || typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

router.post('/', async (req: Request, res: Response) => {
  const { secret, spreadsheetId, tab, rows } = req.body as { secret?: unknown; spreadsheetId?: unknown; tab?: unknown; rows?: unknown }
  if (!secretOk(secret)) { res.status(401).json({ ok: false }); return }
  if (typeof spreadsheetId !== 'string' || typeof tab !== 'string' || !Array.isArray(rows) || rows.length > 500) {
    res.status(400).json({ ok: false, error: 'payload tidak valid' }); return
  }
  try {
    await connectDB()
    const results: string[] = []
    for (const row of rows as SheetRow[]) {
      results.push(await applySheetRow(spreadsheetId, tab, row).catch((err) => `error: ${(err as Error).message}`))
    }
    res.json({ ok: true, results })
  } catch (err) {
    console.error('Sheet hook error:', err)
    res.status(500).json({ ok: false })
  }
})

export default router
