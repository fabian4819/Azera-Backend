/**
 * Link share Threads (threads.com/share/<kode>, dari tombol "Bagikan" di aplikasi) tidak punya halaman embed.
 * Threads me-redirect (302) link itu ke link post asli (threads.com/@user/post/<kode>), browser tidak bisa
 * mengikutinya lintas domain, jadi diselesaikan di server. Gagal/tidak dikenal = link dibiarkan apa adanya.
 */
const SHARE = /^https?:\/\/(?:www\.)?threads\.(?:com|net)\/share\//i

export async function resolveThreadsShare(url: string): Promise<string> {
  if (!SHARE.test(url)) return url
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    const loc = res.headers.get('location') || ''
    const m = loc.match(/^https?:\/\/(?:www\.)?threads\.(?:com|net)\/(@[^/?#]+\/post\/[^/?#]+)/i)
    return m ? `https://www.threads.com/${m[1]}` : url
  } catch {
    return url
  }
}

/** Ubah semua link share Threads di topCreators jadi link post. true = ada yang berubah. */
export async function resolveTopCreatorLinks(creators: { postLink?: string }[] | undefined): Promise<boolean> {
  let changed = false
  for (const c of creators || []) {
    if (!c.postLink || !SHARE.test(c.postLink)) continue
    const next = await resolveThreadsShare(c.postLink)
    if (next !== c.postLink) { c.postLink = next; changed = true }
  }
  return changed
}
