import type { ICampaign } from './campaign.model'

/**
 * Brief Campaign = satu dokumen ala Notion: urutan blok teks / gambar / video / file / link.
 * Disimpan utuh (PUT, autosave editor), bukan per blok. Teks tetap teks biasa (tidak dirender
 * sebagai HTML), media/link wajib URL http(s), jadi isian client tidak bisa menyisipkan script.
 */
export type BriefBlock = NonNullable<ICampaign['briefCampaign']>['blocks'][number]
const KINDS: BriefBlock['kind'][] = ['text', 'file', 'image', 'video', 'link']
const MAX_BLOCKS = 300
const MAX_TEXT = 20_000

/** null = input tidak valid. Blok teks kosong dibuang (editor selalu punya baris kosong untuk mengetik). */
export function parseBriefBlocks(input: unknown): BriefBlock[] | null {
  if (!Array.isArray(input) || input.length > MAX_BLOCKS) return null
  const blocks: BriefBlock[] = []
  for (const raw of input as Record<string, unknown>[]) {
    const kind = raw?.kind as BriefBlock['kind']
    const content = typeof raw?.content === 'string' ? raw.content : null
    if (!KINDS.includes(kind) || content === null) return null
    if (kind === 'text') {
      if (content.length > MAX_TEXT) return null
      if (content.trim()) blocks.push({ kind, content })
      continue
    }
    if (!/^https?:\/\/\S+$/i.test(content.trim())) return null
    blocks.push({ kind, content: content.trim() })
  }
  return blocks
}

/** Kind blok dari mimetype file upload */
export const uploadKind = (mimetype: string): BriefBlock['kind'] =>
  mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('video/') ? 'video' : 'file'

export function setBrief(campaign: ICampaign, blocks: BriefBlock[], filledBy: 'admin' | 'client') {
  campaign.briefCampaign = { blocks, filledBy, updatedAt: new Date() }
  campaign.markModified('briefCampaign')
}

/** Teks broadcast (briefContent) untuk halaman apply publik: bagian fee tidak ditampilkan.
 * Format broadcast (client/src/lib/broadcast.ts) = bagian dipisah baris kosong; yang dibuang:
 * bagian "*Benefit:*" (isinya fee creator) & baris fee PIC/MG ("_fee pic 5k, mg 5k_"). */
export function publicBriefText(text?: string): string {
  if (!text) return ''
  return text
    .split(/\n\s*\n/)
    .filter((section) => {
      const first = section.trim().split('\n')[0].replace(/[*_~\s]/g, '').toLowerCase()
      return !first.startsWith('benefit') && !/^(fee(pic|mg)|mg\d)/.test(first)
    })
    .join('\n\n')
}
