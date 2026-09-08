function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** AD-49 follow-up: konfirmasi ke email creator setelah submit form /kol/register. */
export function creatorRegistrationEmail(name: string): { subject: string; html: string } {
  const subject = 'Pendaftaran KOL Kamu Sudah Kami Terima — AzeraKOL'
  const html = `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #f8f9ff; padding: 32px 16px;">
    <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">
      <div style="background: linear-gradient(135deg, #6728e4, #814bfe); padding: 32px 28px;">
        <p style="margin: 0; font-weight: 900; font-style: italic; font-size: 1.3rem; color: white; letter-spacing: -0.02em;">AZERAKOL</p>
      </div>
      <div style="padding: 32px 28px;">
        <h1 style="margin: 0 0 12px; font-size: 1.25rem; color: #191c20;">Halo, ${escape(name)}! 👋</h1>
        <p style="margin: 0 0 16px; font-size: 0.95rem; color: #464652; line-height: 1.7;">
          Terima kasih sudah mendaftar sebagai creator di AzeraKOL Network. Profil kamu sedang kami review.
        </p>
        <p style="margin: 0 0 16px; font-size: 0.95rem; color: #464652; line-height: 1.7;">
          Tim AzeraKOL akan menghubungi kamu dalam 1–3 hari kerja lewat WhatsApp kalau profil kamu cocok dengan campaign yang sedang berjalan.
        </p>
        <p style="margin: 24px 0 0; font-size: 0.85rem; color: #8a8a99;">
          Email ini dikirim otomatis, tidak perlu dibalas.
        </p>
      </div>
    </div>
  </div>`
  return { subject, html }
}
