import { WaTrigger, WaAudience } from './waTemplate.model'

/**
 * Wording default per trigger — dibedakan bahasa ke client (lebih formal)
 * vs ke talent (lebih santai), sesuai catatan checklist AD-31.
 * Admin bisa edit lewat /admin/wa-templates.
 */
export const DEFAULT_TEMPLATES: Record<WaTrigger, { audience: WaAudience; body: string }> = {
  creator_accepted: {
    audience: 'creator',
    body:
      'Halo {{nama}}! 🎉 Selamat, kamu diterima untuk campaign *{{campaign}}*.\n\n' +
      'Login ke Talent Portal AzeraKOL pakai nomor WA kamu, password: {{password}}\n' +
      'Gabung grup campaign di sini ya buat update & tanya-tanya: {{grup_link}}\n\n' +
      'Ditunggu kabar baiknya! 🙌',
  },
  creator_rejected: {
    audience: 'creator',
    body:
      'Halo {{nama}}, makasih banget udah apply campaign *{{campaign}}*. ' +
      'Kali ini belum rezeki, tapi jangan kapok ya, masih banyak campaign lain menyusul! 🙏',
  },
  brief_campaign: {
    audience: 'creator',
    body: 'Halo {{nama}}, ini brief lengkap untuk campaign *{{campaign}}*:\n\n{{brief}}\n\nKalau ada pertanyaan langsung chat aja ya!',
  },
  reminder_draft: {
    audience: 'creator',
    body: 'Halo {{nama}}, reminder ya buat submit draft konten campaign *{{campaign}}*. Ditunggu sebelum deadline 🙏',
  },
  reminder_upload: {
    audience: 'creator',
    body: 'Halo {{nama}}, draft kamu untuk *{{campaign}}* sudah oke, yuk segera posting & upload link-nya ke Talent Portal ya!',
  },
  reminder_revision: {
    audience: 'creator',
    body: 'Halo {{nama}}, ada sedikit revisi untuk draft campaign *{{campaign}}*. Cek Talent Portal buat detailnya ya, makasih!',
  },
  reminder_insight: {
    audience: 'creator',
    body: 'Halo {{nama}}, jangan lupa upload screenshot insight untuk campaign *{{campaign}}* ya (minimal H+2 setelah posting). Makasih!',
  },
  reminder_payment_creator: {
    audience: 'creator',
    body: 'Halo {{nama}}, fee kamu untuk campaign *{{campaign}}* sedang kami proses ya, mohon ditunggu. Makasih atas kerja samanya!',
  },
  payment_completed: {
    audience: 'creator',
    body: 'Halo {{nama}}, fee campaign *{{campaign}}* sudah kami transfer ya. Terima kasih banyak atas kontribusinya! 🙌',
  },
  invoice_new: {
    audience: 'client',
    body:
      '✅ Invoice {{invoice_number}}\n📋 {{campaign}}\n👤 {{bill_to}}\n💰 Total: {{total}}\n📎 {{pdf_url}}\n\n' +
      'Silakan lakukan pembayaran dan konfirmasi di: {{payment_link}}',
  },
  invoice_paid: {
    audience: 'client',
    body: 'Yth. {{bill_to}}, pembayaran invoice {{invoice_number}} campaign {{campaign}} sudah kami terima & verifikasi. Terima kasih! 🙏',
  },
  reminder_payment_client: {
    audience: 'client',
    body: 'Yth. {{bill_to}}, mengingatkan invoice {{invoice_number}} campaign {{campaign}} {{due_label}}. Total: {{total}}. Link: {{payment_link}}',
  },
  campaign_started: {
    audience: 'client',
    body: 'Yth. {{bill_to}}, campaign *{{campaign}}* resmi dimulai hari ini. Kami akan update progress secara berkala. Terima kasih atas kepercayaannya!',
  },
  campaign_completed: {
    audience: 'client',
    body: 'Yth. {{bill_to}}, campaign *{{campaign}}* telah selesai. Laporan lengkap akan segera menyusul. Terima kasih atas kerja sama yang baik!',
  },
  daily_progress_report: {
    audience: 'client',
    body:
      '📊 Progress Report — {{campaign}} ({{tanggal}})\n\n' +
      'Draft masuk: {{draft_count}}\nSudah approve: {{approved_count}}\nMasih revisi: {{revision_count}}\n' +
      'Sudah posting: {{posted_count}}\nInsight masuk: {{insight_count}}',
  },
  broadcast_campaign: {
    audience: 'creator',
    body:
      '{{urgent_label}}📢 *{{title}}*\n\n' +
      '{{location_schedule}}' +
      '💰 Fee: {{fee}}\n💳 TOP Payment: {{top_payment}}\n\n' +
      '📋 Syarat:\n{{syarat}}\n\n' +
      '📝 SOW:\n{{sow}}\n\n' +
      '{{note}}' +
      '\n🔗 Daftar: {{apply_link}}\n\n' +
      'PIC: {{pic}}',
  },
}
