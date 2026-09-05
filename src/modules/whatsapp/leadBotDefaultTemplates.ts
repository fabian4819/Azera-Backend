import { LeadBotTrigger } from './leadBotTemplate.model'

interface LeadBotTemplateDefault {
  body: string
  label: string
  description: string
  placeholders?: string[]
}

export const LEAD_BOT_DEFAULTS: Record<LeadBotTrigger, LeadBotTemplateDefault> = {
  greeting: {
    label: 'Sapaan Awal',
    body: 'Halo, kak! 👋 Selamat datang di *AzeraKOL* — agency KOL marketing.',
    description: 'Dikirim sekali di awal, sebelum menu utama, saat lead baru pertama kali chat (atau sesi lama sudah kadaluarsa).',
  },
  menu: {
    label: 'Menu Utama',
    body:
      'Ada yang bisa kami bantu? Silakan pilih:\n' +
      '1️⃣ Daftar Brand (mau bikin campaign)\n' +
      '2️⃣ Daftar KOL/Creator\n' +
      '3️⃣ Butuh bantuan lain (Support)\n\n' +
      'Balas dengan angka 1, 2, atau 3.',
    description: 'Menu pilihan 1/2/3. Bot menentukan pilihan dari angka atau kata kunci yang diketik lead, bukan dari isi teks ini — jadi bebas diubah wordingnya asal jelas.',
  },
  brand_intro: {
    label: 'Pembuka Form Brand',
    body: 'Oke, siap bantu daftarkan brand kamu! 🎉\n\nTinggal *copy* format di bawah ini, isi bagian setelah titik dua, lalu kirim balik ke chat ini dalam satu pesan ya:',
    description:
      'Kalimat pembuka sebelum template isian Brand dikirim. Template field (Nama Lengkap, No. WhatsApp, dst) dan daftar pilihan Jasa/Budget ditambahkan otomatis SETELAH kalimat ini — lihat bagian terkunci di bawah, tidak bisa diubah dari sini.',
  },
  brand_confirmation: {
    label: 'Konfirmasi Data Tersimpan',
    body:
      'Sip, sudah kami terima! ✅\n\n' +
      '*Ringkasan:*\n' +
      'Nama: {{fullName}}\n' +
      'Company: {{companyName}}\n' +
      'Jasa: {{jasa}}\n' +
      'Budget: {{budget}}\n' +
      '{{timelineLine}}' +
      'Tim kami akan segera menghubungi kamu via WhatsApp untuk follow-up. Terima kasih sudah menghubungi AzeraKOL! 🙏',
    description:
      'Dikirim setelah data Brand berhasil disimpan ke sistem. {{timelineLine}} otomatis kosong (tanpa baris) kalau lead tidak isi timeline — jangan tambahkan "Timeline:" manual di teks ini.',
    placeholders: ['fullName', 'companyName', 'jasa', 'budget', 'timelineLine'],
  },
  kol_redirect: {
    label: 'Redirect ke Form KOL',
    body: 'Untuk daftar sebagai KOL/Creator, silakan isi form pendaftaran di link berikut ya:\n\n{{link}}\n\nKalau ada pertanyaan lain, ketik *menu* untuk kembali ke menu utama. 🙌',
    description: 'Dikirim saat lead pilih menu KOL/Creator. Placeholder {{link}} otomatis diisi link form pendaftaran KOL — jangan dihapus kalau masih mau linknya muncul.',
    placeholders: ['link'],
  },
  support: {
    label: 'Balasan Support',
    body: 'Baik kak, mohon ditunggu ya, admin kami akan segera membalas pesan kamu 🙏',
    description: 'Dikirim saat lead pilih menu Support. Setelah ini bot diam otomatis selama 12 jam untuk nomor tsb supaya admin bisa ambil alih manual.',
  },
  brand_incomplete: {
    label: 'Form Brand Belum Lengkap/Valid',
    body: 'Beberapa bagian masih perlu dilengkapi/diperbaiki nih kak:',
    description: 'Kalimat pembuka sebelum daftar rincian field yang kosong/salah — daftar rinciannya dibuat otomatis oleh sistem sesuai balasan lead, bukan bagian dari template ini.',
  },
  brand_wrong_format: {
    label: 'Format Sama Sekali Tidak Dikenali',
    body: 'Sepertinya belum sesuai format ya kak 🙏 Yuk copy template ini, isi, terus kirim balik:',
    description: 'Dikirim kalau balasan lead sama sekali tidak cocok format apa pun. Template isian dikirim ulang otomatis setelah kalimat ini.',
  },
}
