import { cloudinary } from './cloudinary'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

/** URL cover video TikTok dari data halaman videonya. oEmbed TikTok tidak lagi mengirim thumbnail_url.
 * TikTok sering mengosongkan data ini untuk IP datacenter (VPS), jadi hasilnya bisa null. */
export async function fetchTikTokCover(link: string): Promise<string | null> {
  try {
    const r = await fetch(link.split('?')[0], { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const m = (await r.text()).match(/"cover":"(https:[^"]+)"/)
    return m ? JSON.parse(`"${m[1]}"`) : null
  } catch {
    return null
  }
}

type Creator = { postLink?: string; thumb?: string }

/** Isi `thumb` (Cloudinary, permanen) untuk top creator TikTok yang belum punya; cover TikTok sendiri kedaluwarsa.
 * Best-effort: gagal (mis. TikTok kosong di VPS) = dibiarkan, dicoba lagi saat portfolio disimpan berikutnya. */
export async function fillCreatorThumbs(creators: Creator[] | undefined): Promise<boolean> {
  let changed = false
  for (const c of creators || []) {
    if (c.thumb || !/tiktok\.com\/@[^/]+\/video\/\d+/.test(c.postLink || '')) continue
    const cover = await fetchTikTokCover(c.postLink!)
    if (!cover) continue
    try {
      c.thumb = (await cloudinary.uploader.upload(cover, { folder: 'azera/portfolio/thumbs' })).secure_url
      changed = true
    } catch (err) {
      console.error('Portfolio thumb upload error:', (err as Error).message)
    }
  }
  return changed
}
