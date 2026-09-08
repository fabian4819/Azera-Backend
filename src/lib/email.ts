import nodemailer from 'nodemailer'
import { env } from '../config/env'

// Kirim email transactional (mis. konfirmasi pendaftaran KOL) lewat Gmail/Google Workspace
// SMTP milik AzeraKOL (hello@azerakol.id). Butuh App Password (bukan password akun biasa),
// di-generate dari Google Account -> Security -> App passwords (perlu 2-Step Verification aktif).
const transporter = env.email.user && env.email.pass
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.email.user, pass: env.email.pass },
    })
  : null

/**
 * Best-effort — dipanggil fire-and-forget dari route (jangan di-await secara blocking di response
 * utama), supaya kegagalan kirim email tidak menggagalkan alur pendaftaran/aksi utama.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!transporter) {
    console.error('Email not configured: EMAIL_USER/EMAIL_PASS kosong, skip kirim ke', to)
    return
  }
  await transporter.sendMail({
    from: `"AzeraKOL" <${env.email.user}>`,
    to,
    subject,
    html,
  })
}
