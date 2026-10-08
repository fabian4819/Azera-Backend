import dotenv from 'dotenv'

// Modul terpisah yang di-import PALING PERTAMA di index.ts: import dijalankan sebelum kode biasa,
// jadi dotenv.config() di badan index.ts telat, config/env.ts sudah terbaca (CLIENT_ORIGIN jatuh ke '*').
// .env.local (gitignored) override beberapa var untuk dev lokal, dimuat dulu supaya menang; .env mengisi sisanya.
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })
