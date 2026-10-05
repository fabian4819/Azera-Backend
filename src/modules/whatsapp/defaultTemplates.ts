import { WaTrigger, WaAudience } from './waTemplate.model'

/**
 * Wording default per trigger — ke client sopan & formal (Bapak/Ibu), ke creator ramah (Kak),
 * sesuai catatan checklist AD-31. Pesan ke creator yang diterima selalu bawa {{portal_link}}.
 * Admin bisa edit lewat /admin/wa-templates.
 */
export const DEFAULT_TEMPLATES: Record<WaTrigger, { audience: WaAudience; body: string }> = {
  creator_accepted: {
    audience: 'creator',
    body: "Halo Kak {{nama}}! 🎉\n\nSelamat, Kakak terpilih untuk campaign *{{campaign}}*. Senang sekali bisa berkolaborasi bareng Kakak! 🥳\n\n📊 Dashboard campaign Kakak (update link draft, link posting, dan insight di sini):\n{{portal_link}}\n_Link ini khusus untuk Kakak, mohon tidak dibagikan ke orang lain ya._\n\n👥 Yuk gabung grup campaign untuk info & tanya-jawab:\n{{grup_link}}\n\nBrief lengkap akan segera kami kirim. Semangat berkarya, Kak! ✨",
  },
  creator_rejected: {
    audience: 'creator',
    body: "Halo Kak {{nama}} 😊\n\nTerima kasih banyak sudah mendaftar campaign *{{campaign}}*. Setelah kami review, untuk campaign kali ini Kakak belum terpilih.\n\nJangan berkecil hati ya, Kak! Masih banyak campaign seru lain yang akan datang, dan kami tunggu pendaftaran Kakak berikutnya 💜",
  },
  brief_campaign: {
    audience: 'creator',
    body: "Halo Kak {{nama}}! 👋\n\nBerikut brief lengkap untuk campaign *{{campaign}}*:\n\n{{brief}}\n\n📊 Progress (link draft, posting, insight) bisa Kakak isi di dashboard ini:\n{{portal_link}}\n\nKalau ada yang kurang jelas, jangan ragu tanya kami ya, Kak. Selamat berkarya! ✨",
  },
  reminder_draft: {
    audience: 'creator',
    body: "Halo Kak {{nama}}! 👋\n\nSekadar mengingatkan, draft konten untuk campaign *{{campaign}}* ditunggu sebelum deadline ya 🙏\n\nKalau sudah siap, link draft-nya bisa langsung diisi di dashboard Kakak:\n{{portal_link}}\n\nTerima kasih, Kak! Semangat 💪",
  },
  reminder_upload: {
    audience: 'creator',
    body: "Halo Kak {{nama}}! 🎉\n\nKabar baik, draft Kakak untuk campaign *{{campaign}}* sudah disetujui! 🙌\n\nYuk, konten-nya segera diposting, lalu isi link posting-nya di dashboard Kakak:\n{{portal_link}}\n\nTerima kasih, Kak! Ditunggu hasil kerennya ✨",
  },
  reminder_revision: {
    audience: 'creator',
    body: "Halo Kak {{nama}} 😊\n\nTerima kasih untuk draft campaign *{{campaign}}*-nya! Ada sedikit revisi yang perlu disesuaikan ya, Kak — detailnya akan diinfokan tim kami.\n\nSetelah direvisi, cukup perbarui link draft di dashboard Kakak:\n{{portal_link}}\n\nMakasih banyak atas kerja samanya, Kak 🙏",
  },
  reminder_insight: {
    audience: 'creator',
    body: "Halo Kak {{nama}}! 👋\n\nTerima kasih sudah posting konten campaign *{{campaign}}* 🙌 Jangan lupa isi data insight dan upload screenshot-nya ya, Kak (minimal H+2 setelah posting).\n\nBisa langsung diisi di dashboard Kakak:\n{{portal_link}}\n\nTerima kasih, Kak! 💜",
  },
  reminder_payment_creator: {
    audience: 'creator',
    body: "Halo Kak {{nama}} 😊\n\nFee Kakak untuk campaign *{{campaign}}* sedang kami proses ya. Mohon ditunggu sebentar, kami akan kabari begitu sudah ditransfer.\n\nTerima kasih atas kerja sama dan kesabarannya, Kak 🙏",
  },
  payment_completed: {
    audience: 'creator',
    body: "Halo Kak {{nama}}! 🎉\n\nFee campaign *{{campaign}}* sudah kami transfer ya, Kak. Silakan dicek 😊\n\nTerima kasih banyak atas kontribusi dan karya kerennya. Sampai jumpa di campaign berikutnya! 💜",
  },
  invoice_new: {
    audience: 'client',
    body: "Halo Bapak/Ibu {{bill_to}} 👋\n\nTerima kasih atas kepercayaannya bekerja sama dengan AzeraKOL. Berikut invoice untuk campaign *{{campaign}}*:\n\n🧾 No. Invoice: {{invoice_number}}\n💰 Total: {{total}}\n📎 Invoice (PDF): {{pdf_url}}\n\nPembayaran dan konfirmasi dapat dilakukan melalui link berikut:\n{{payment_link}}\n\nJika ada pertanyaan, silakan hubungi kami kapan saja. Terima kasih! 🙏",
  },
  invoice_paid: {
    audience: 'client',
    body: "Halo Bapak/Ibu {{bill_to}} 😊\n\nPembayaran invoice *{{invoice_number}}* untuk campaign *{{campaign}}* sudah kami terima dan verifikasi. ✅\n\nTerima kasih banyak atas kerja samanya. Senang bisa bermitra dengan Bapak/Ibu! 🙏",
  },
  reminder_payment_client: {
    audience: 'client',
    body: "Halo Bapak/Ibu {{bill_to}} 👋\n\nIzin mengingatkan dengan hormat, invoice *{{invoice_number}}* untuk campaign *{{campaign}}* {{due_label}}.\n\n💰 Total: {{total}}\n🔗 Pembayaran & konfirmasi: {{payment_link}}\n\nApabila pembayaran sudah dilakukan, mohon abaikan pesan ini. Terima kasih atas perhatiannya 🙏",
  },
  campaign_started: {
    audience: 'client',
    body: "Halo Bapak/Ibu {{bill_to}}! 🎉\n\nDengan senang hati kami informasikan bahwa campaign *{{campaign}}* resmi dimulai hari ini. 🚀\n\nKami akan menyampaikan update progress secara berkala. Terima kasih atas kepercayaannya kepada AzeraKOL! 🙏",
  },
  campaign_completed: {
    audience: 'client',
    body: "Halo Bapak/Ibu {{bill_to}}! 🎉\n\nCampaign *{{campaign}}* telah selesai berjalan. Terima kasih atas kerja sama yang luar biasa! 🙌\n\nLaporan lengkap hasil campaign akan segera kami kirimkan. Kami tunggu kolaborasi berikutnya ya 😊",
  },
  // Ke grup tim internal AZERA (bukan brand) — lewat bot Creator/community, bukan Partnership.
  daily_progress_report: {
    audience: 'creator',
    body: "📊 *Progress Report — {{campaign}}*\n🗓️ {{tanggal}}\n\n📝 Draft masuk: {{draft_count}}\n✅ Draft disetujui: {{approved_count}}\n🔁 Masih revisi: {{revision_count}}\n📲 Sudah posting: {{posted_count}}\n📈 Insight masuk: {{insight_count}}\n\nSemangat, tim! 💪",
  },
  broadcast_campaign: {
    audience: 'creator',
    body: "{{urgent_label}}📢 *{{title}}*\n\nHalo Kak! Ada campaign seru nih, yuk ikutan! ✨\n\n{{location_schedule}}💰 Fee: {{fee}}\n💳 TOP Payment: {{top_payment}}\n\n📋 Syarat:\n{{syarat}}\n\n📝 SOW:\n{{sow}}\n\n{{note}}\n🔗 Daftar di sini: {{apply_link}}\n\nPIC: {{pic}}\nDitunggu pendaftarannya, Kak! 💜",
  },
}
