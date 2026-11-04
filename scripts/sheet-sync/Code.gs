/**
 * AZERA — sinkron Google Sheet → platform (realtime).
 *
 * Dipasang SEKALI di akun hello@azerakol.id sebagai Web App (lihat README.md di folder ini).
 * - Server memanggil doPost({action:'install'|'uninstall', spreadsheetId}) untuk memasang/melepas
 *   pemicu onEdit per spreadsheet campaign (internal & client).
 * - Tiap edit di tab MANA PUN, onSheetEdit mengirim baris yang diedit (lengkap dengan header, termasuk
 *   kolom ID tersembunyi) ke https://azerakol.id/api/sheet-hook. Server yang memutuskan tab/kolom mana
 *   yang diterapkan, jadi tab baru yang bisa diedit tidak perlu deploy ulang skrip ini.
 * Batas Google: 20 pemicu per akun per skrip (= 10 campaign aktif); sisanya disinkron server lewat polling.
 */
const SECRET = 'GANTI_DENGAN_SHEET_HOOK_SECRET';
const WEBHOOK = 'https://azerakol.id/api/sheet-hook';

function doPost(e) {
  const body = JSON.parse((e.postData && e.postData.contents) || '{}');
  if (body.secret !== SECRET) return json_({ ok: false, error: 'secret' });
  const id = body.spreadsheetId;
  if (!id) return json_({ ok: false, error: 'spreadsheetId' });
  const mine = ScriptApp.getProjectTriggers().filter(function (t) { return t.getTriggerSourceId() === id; });
  if (body.action === 'install') {
    if (!mine.length) ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(id).onEdit().create();
    return json_({ ok: true });
  }
  if (body.action === 'uninstall') {
    mine.forEach(function (t) { ScriptApp.deleteTrigger(t); });
    return json_({ ok: true });
  }
  return json_({ ok: false, error: 'action' });
}

function onSheetEdit(e) {
  const sheet = e.range.getSheet();
  const first = e.range.getRow();
  const last = first + e.range.getNumRows() - 1;
  const start = Math.max(first, 2); // baris 1 = header
  if (last < start) return;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const values = sheet.getRange(start, 1, last - start + 1, lastCol).getDisplayValues();
  const rows = values.map(function (r) {
    const row = {};
    headers.forEach(function (h, i) { row[h] = r[i]; });
    return row;
  });
  UrlFetchApp.fetch(WEBHOOK, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ secret: SECRET, spreadsheetId: e.source.getId(), tab: sheet.getName(), rows: rows }),
  });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
