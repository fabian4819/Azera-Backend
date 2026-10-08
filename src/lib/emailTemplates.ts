function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Kerangka email bermerek AzeraKOL, isi `body` sudah HTML aman (escape di pemanggil). */
function layout(body: string): string {
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #f8f9ff; padding: 32px 16px;">
    <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">
      <div style="background: linear-gradient(135deg, #6728e4, #814bfe); padding: 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
          <tr>
            <td style="width: 36px; padding-right: 10px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="36" height="36" style="background: white; border-radius: 50%; text-align: center;">
                <tr><td align="center" valign="middle">
                  <img src="https://azerakol.id/logo-transparent.png" alt="AzeraKOL" width="22" height="22" style="display: block; margin: 0 auto;" />
                </td></tr>
              </table>
            </td>
            <td style="vertical-align: middle;">
              <span style="font-weight: 900; font-size: 1.3rem; color: white; letter-spacing: -0.02em;">AZERAKOL</span>
            </td>
          </tr>
        </table>
      </div>
      <div style="padding: 32px 28px;">
        ${body}
        <p style="margin: 24px 0 0; font-size: 0.85rem; color: #8a8a99;">
          Email ini dikirim otomatis, tidak perlu dibalas.
        </p>
      </div>
    </div>
  </div>`
}

const P = 'margin: 0 0 16px; font-size: 0.95rem; color: #464652; line-height: 1.7;'

/** AD-49 follow-up: konfirmasi ke email creator setelah submit form /kol/register. */
export function creatorRegistrationEmail(name: string): { subject: string; html: string } {
  return {
    subject: 'Pendaftaran KOL Kamu Sudah Kami Terima | AzeraKOL',
    html: layout(`
        <h1 style="margin: 0 0 12px; font-size: 1.25rem; color: #191c20;">Halo, ${escape(name)}! 👋</h1>
        <p style="${P}">Terima kasih sudah mendaftar sebagai creator di AzeraKOL Network. Profil kamu sedang kami review.</p>
        <p style="${P}">Tim AzeraKOL akan menghubungi kamu lewat WhatsApp kalau profil kamu cocok dengan campaign yang sedang berjalan.</p>`),
  }
}

/** Creator diterima di campaign, berisi magic link portal (tabel progress campaign). */
export function creatorAcceptedEmail(name: string, campaign: string, portalLink: string, groupLink?: string): { subject: string; html: string } {
  return {
    subject: `Selamat, kamu diterima di campaign ${campaign} | AzeraKOL`,
    html: layout(`
        <h1 style="margin: 0 0 12px; font-size: 1.25rem; color: #191c20;">Selamat, ${escape(name)}! 🎉</h1>
        <p style="${P}">Kamu diterima untuk campaign <strong>${escape(campaign)}</strong>.</p>
        <p style="${P}">Update progress campaign kamu (link draft, link posting, insight) langsung di tabel lewat tombol di bawah. Simpan link ini ya, jangan dibagikan ke orang lain.</p>
        <p style="margin: 0 0 20px;"><a href="${escape(portalLink)}" style="display: inline-block; background: #6728e4; color: white; text-decoration: none; font-weight: 700; padding: 12px 22px; border-radius: 999px;">Buka Dashboard Campaign</a></p>
        ${groupLink ? `<p style="${P}">Gabung grup WA campaign: <a href="${escape(groupLink)}" style="color: #6728e4;">${escape(groupLink)}</a></p>` : ''}`),
  }
}
