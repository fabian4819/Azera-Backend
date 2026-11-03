/**
 * Jembatan ke Google Apps Script (scripts/sheet-sync.gs, dipasang sekali oleh akun hello@azerakol.id):
 * server minta skrip memasang/melepas pemicu onEdit per spreadsheet; pemicu itu mengirim edit ke
 * POST /api/sheet-hook. Env: APPS_SCRIPT_URL (URL Web App hasil deploy) + SHEET_HOOK_SECRET (sama di skrip).
 * Tanpa env = fitur mati, sheet → platform jalan lewat polling cadangan (sheetPoll.service.ts).
 */
const cfg = () => ({ url: process.env.APPS_SCRIPT_URL, secret: process.env.SHEET_HOOK_SECRET })
export const sheetHookSecret = () => cfg().secret

async function callScript(action: 'install' | 'uninstall', spreadsheetId: string): Promise<boolean> {
  const { url, secret } = cfg()
  if (!url || !secret) return false
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, action, spreadsheetId }) })
    const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
    if (!body.ok) console.error(`Sheet hook ${action} gagal [${spreadsheetId}]:`, body.error || res.status)
    return Boolean(body.ok)
  } catch (err) {
    console.error(`Sheet hook ${action} error [${spreadsheetId}]:`, (err as Error).message)
    return false
  }
}

/** true = pemicu terpasang. false (mis. sudah 20 pemicu, batas Google) = campaign ini pakai polling cadangan. */
export const installSheetHook = (spreadsheetId: string) => callScript('install', spreadsheetId)
export const uninstallSheetHook = (spreadsheetId: string) => callScript('uninstall', spreadsheetId)
