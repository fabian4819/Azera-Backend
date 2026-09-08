import { Resend } from 'resend'
import { env } from '../config/env'

// Kirim email transactional (mis. konfirmasi pendaftaran KOL) lewat Resend.
// RESEND_FROM_EMAIL default ke sandbox address Resend (onboarding@resend.dev) yang jalan
// tanpa verifikasi domain — ganti ke alamat di domain azerakol.id (mis. "AzeraKOL <hello@azerakol.id>")
// setelah domain-nya diverifikasi di dashboard Resend.
const resend = env.resend.apiKey ? new Resend(env.resend.apiKey) : null

/**
 * Best-effort — dipanggil fire-and-forget dari route (jangan di-await secara blocking di response
 * utama), supaya kegagalan kirim email tidak menggagalkan alur pendaftaran/aksi utama.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    console.error('Email not configured: RESEND_API_KEY kosong, skip kirim ke', to)
    return
  }
  const { error } = await resend.emails.send({
    from: env.resend.fromEmail,
    to,
    subject,
    html,
  })
  if (error) throw new Error(error.message)
}
