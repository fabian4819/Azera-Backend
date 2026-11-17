/**
 * Approve client lewat tab manual di spreadsheet Listing (mis. tab "List ok" berisi creator yang
 * di-ACC client). Tiap baris dicocokkan ke pendaftar campaign tanpa peduli urutan/nama kolom:
 * username/link sosmed dulu, lalu nomor WA, terakhir nama lengkap (cuma kalau namanya unik).
 */
export interface MatchCandidate { id: string; name: string; phone: string; usernames: string[] }
export interface RowMatch { row: number; label: string; id?: string; by?: 'username' | 'phone' | 'name'; ambiguous?: boolean }

const normUser = (s: string) => s.trim().toLowerCase().replace(/^@+/, '').replace(/[/?#].*$/, '')
const normPhone = (s: string) => {
  const d = s.replace(/\D/g, '')
  return d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d
}
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Handle dari link profil (tiktok.com/@x, instagram.com/x, threads.net/@x, x.com/x) atau teks username biasa */
function cellUsernames(cell: string): string[] {
  const out: string[] = []
  for (const m of cell.matchAll(/(?:tiktok\.com|instagram\.com|threads\.(?:net|com)|x\.com|twitter\.com)\/@?([A-Za-z0-9._]+)/gi)) out.push(m[1].toLowerCase())
  if (!out.length && /^@?[A-Za-z0-9._]{3,30}$/.test(cell.trim())) out.push(normUser(cell))
  return out
}

export function matchClientRows(rows: string[][], candidates: MatchCandidate[]): RowMatch[] {
  const byUser = new Map<string, Set<string>>()
  const byPhone = new Map<string, string[]>()
  const byName = new Map<string, string[]>()
  for (const c of candidates) {
    for (const u of c.usernames) {
      const k = normUser(u)
      if (k) byUser.set(k, (byUser.get(k) || new Set()).add(c.id))
    }
    if (c.phone) byPhone.set(normPhone(c.phone), [...(byPhone.get(normPhone(c.phone)) || []), c.id])
    const n = normName(c.name)
    byName.set(n, [...(byName.get(n) || []), c.id])
  }
  const results: RowMatch[] = []
  rows.forEach((cells, i) => {
    const values = cells.map((v) => String(v ?? '').trim()).filter(Boolean)
    if (!values.length) return
    const userHits = new Set(values.flatMap(cellUsernames).flatMap((u) => [...(byUser.get(u) || [])]))
    // Nomor WA yang dipakai beberapa baris (akun buzzer satu orang) tidak ditebak, sama seperti nama dobel
    const phoneHits = new Set(values.filter((v) => /^[+\d][\d\s-]{8,}$/.test(v)).map((v) => byPhone.get(normPhone(v))).filter((ids): ids is string[] => ids?.length === 1).map((ids) => ids[0]))
    const nameHits = values.map((v) => byName.get(normName(v))).filter((ids): ids is string[] => ids?.length === 1).map((ids) => ids[0])
    const label = values.slice(0, 3).join(' · ')
    const row = i + 1
    if (userHits.size === 1) results.push({ row, label, id: [...userHits][0], by: 'username' })
    else if (userHits.size > 1) results.push({ row, label, ambiguous: true })
    else if (phoneHits.size === 1) results.push({ row, label, id: [...phoneHits][0], by: 'phone' })
    else if (new Set(nameHits).size === 1) results.push({ row, label, id: nameHits[0], by: 'name' })
    else results.push({ row, label })
  })
  return results
}
