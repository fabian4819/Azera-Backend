const WA_NUMBER = process.env.WA_NUMBER || '6288201586126'

export function buildBrandWALink(data: {
  namaBrand: string
  namaPIC: string
  kategori: string
  website: string
  paket: string
  budget: string
  durasi: string
  tujuan: string[]
  targetAudience: string
  deskripsi: string
}) {
  const message = `Halo Azera! 👋

Saya ingin konsultasi kampanye KOL untuk brand kami.

*Detail Brand:*
• Brand: ${data.namaBrand}
• PIC: ${data.namaPIC}
• Kategori: ${data.kategori}
• Website/IG: ${data.website || '-'}

*Kebutuhan Kampanye:*
• Paket: ${data.paket}
• Budget: ${data.budget}
• Durasi: ${data.durasi}
• Tujuan: ${data.tujuan.join(', ')}

*Target Audience:*
${data.targetAudience}

*Deskripsi Produk:*
${data.deskripsi}

Mohon info lebih lanjut. Terima kasih!`

  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`
}

export function buildKOLApprovalWALink(data: { whatsapp: string; namaLengkap: string }) {
  const message = `Halo ${data.namaLengkap}! 👋

Selamat! Kamu telah berhasil bergabung dengan Jaringan KOL Azera. 🎉

Tim kami telah meninjau profil kamu dan kamu memenuhi syarat untuk bergabung.

Langkah selanjutnya:
1. Konfirmasi keikutsertaan kamu
2. Lengkapi onboarding brief dari tim kami
3. Siap untuk campaign pertama kamu!

Balas pesan ini untuk memulai. Selamat bergabung! 🚀

— Tim Azera`

  return `https://wa.me/${data.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
}

export function buildKOLRejectionWALink(data: { whatsapp: string; namaLengkap: string; alasan?: string }) {
  const message = `Halo ${data.namaLengkap}! 👋

Terima kasih telah mendaftar sebagai KOL Azera.

Setelah meninjau profil kamu, saat ini kami belum bisa melanjutkan ke tahap berikutnya.${data.alasan ? `\n\nCatatan: ${data.alasan}` : ''}

Kamu bisa mendaftar kembali setelah 3 bulan atau setelah ada peningkatan pada profil kamu.

Terima kasih atas minat kamu. Semangat terus! 💪

— Tim Azera`

  return `https://wa.me/${data.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
}
