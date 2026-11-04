# Sinkron Google Sheet → platform (Apps Script)

Edit di spreadsheet campaign (internal & client) diterapkan ke platform dalam ±1–3 detik. Skrip mengirim
edit dari semua tab; server yang menentukan kolom mana yang diterima (lihat `src/modules/campaigns/sheetEdit.service.ts`),
jadi menambah tab/kolom yang bisa diedit tidak perlu deploy ulang skrip. Tanpa skrip ini, server tetap menyinkron lewat polling tiap 20 detik.

## Setup sekali (akun hello@azerakol.id)

1. Login sebagai **hello@azerakol.id**, buka https://script.google.com → **Proyek baru**, beri nama "AZERA Sheet Sync".
2. Hapus isi `Code.gs`, tempel isi `Code.gs` dari folder ini. Ganti `GANTI_DENGAN_SHEET_HOOK_SECRET`
   dengan nilai `SHEET_HOOK_SECRET` dari server (minta ke developer, jangan disebar).
3. ⚙️ **Setelan proyek** → centang **Tampilkan file manifes "appsscript.json"**, lalu ganti isinya dengan
   `appsscript.json` dari folder ini.
4. **Terapkan → Penerapan baru** → jenis **Aplikasi web**. *Jalankan sebagai*: **Saya (hello@azerakol.id)**,
   *Yang memiliki akses*: **Siapa saja**. Klik **Terapkan**, lalu **Izinkan akses** (pilih akun, Lanjutan →
   buka proyek → Izinkan).
5. Salin **URL aplikasi web** (berakhiran `/exec`) dan kirim ke developer untuk diisi sebagai `APPS_SCRIPT_URL`
   di server.

Sesudah itu server memasang pemicu sendiri per spreadsheet campaign (lihat **Pemicu** di menu kiri Apps Script).

## Catatan

- Batas Google: **20 pemicu per akun per skrip**, = 10 campaign aktif (internal + client). Campaign selesai /
  dibatalkan / dihapus melepas pemicunya. Lebih dari itu: polling server.
- Jangan ganti password / cabut izin akun ini tanpa memasang ulang (langkah 4), pemicu berhenti diam-diam
  (polling tetap jalan sebagai cadangan).
- Ubah `Code.gs`: **Terapkan → Kelola penerapan → Edit → Versi baru** supaya URL tetap sama.
