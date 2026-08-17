import { env } from '../config/env'

/**
 * Provider-agnostic AI abstraction — lihat docs/plan/01-architecture.md.
 * Text (brief/insight/case study/report) default ke DeepSeek; vision (baca
 * screenshot insight) default ke Gemini Flash karena DeepSeek tidak punya
 * model vision. Ganti provider cukup lewat env, tanpa refactor caller.
 */

export interface ParsedInsight {
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  reach?: number
}

/**
 * Platform yang didukung untuk parsing insight — lihat docs/plan/02-notes-meeting.md
 * (notes 17 Agu 2026). YouTube di-drop dari scope (keputusan klien 17 Agu 2026).
 */
export type InsightPlatform = 'instagram' | 'tiktok' | 'threads' | 'x'

async function generateTextDeepseek(prompt: string, system?: string): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.ai.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!res.ok) throw new Error(`DeepSeek error: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { choices: { message: { content: string } }[] }
  return data.choices[0].message.content
}

async function parseImageGemini(imageUrl: string, instruction: string): Promise<ParsedInsight> {
  const imageRes = await fetch(imageUrl)
  const buffer = Buffer.from(await imageRes.arrayBuffer())
  const mimeType = imageRes.headers.get('content-type') || 'image/png'

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${env.ai.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: instruction },
              { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  )
  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] }
  const text = data.candidates[0].content.parts[0].text
  return JSON.parse(text) as ParsedInsight
}

export async function generateText(prompt: string, system?: string): Promise<string> {
  switch (env.ai.textProvider) {
    case 'deepseek':
      return generateTextDeepseek(prompt, system)
    default:
      throw new Error(`Unsupported AI_TEXT_PROVIDER: ${env.ai.textProvider}`)
  }
}

const INSIGHT_BASE_INSTRUCTION =
  'Baca screenshot insight media sosial ini. Kembalikan HANYA JSON (tanpa penjelasan) dengan field: views, reach, likes, comments, shares, saves — semua angka, gunakan null untuk field yang tidak ada di screenshot ini atau tidak berlaku untuk platform ini.'

// Label UI Instagram/TikTok/X/Threads yang perlu di-mapping ke nama field kita,
// dikonfirmasi klien (docs/plan/02-notes-meeting.md, notes 17 Agu 2026).
const INSIGHT_PLATFORM_HINTS: Record<InsightPlatform, string> = {
  instagram:
    'Platform: Instagram. Label "Akun yang dijangkau" / "Accounts reached" masuk field reach. "Dibagikan"/"Shares" masuk shares. "Disimpan"/"Saved" masuk saves.',
  tiktok:
    'Platform: TikTok. Label "Total Penonton" / "Total viewers" masuk field reach. Semua field (views, reach, likes, comments, shares, saves) biasanya tersedia.',
  threads:
    'Platform: Threads. Field reach dan saves TIDAK ADA di platform ini — set null, jangan dikira-kira. Label "Posting ulang" / "Reposts" masuk field shares.',
  x: 'Platform: X (Twitter). Field reach dan saves TIDAK ADA di platform ini — set null, jangan dikira-kira. Label "Posting ulang" / "Reposts" / "Retweets" masuk field shares.',
}

export async function parseInsightScreenshot(imageUrl: string, platform: InsightPlatform): Promise<ParsedInsight> {
  const instruction = `${INSIGHT_BASE_INSTRUCTION}\n${INSIGHT_PLATFORM_HINTS[platform]}`
  switch (env.ai.visionProvider) {
    case 'gemini':
      return parseImageGemini(imageUrl, instruction)
    default:
      throw new Error(`Unsupported AI_VISION_PROVIDER: ${env.ai.visionProvider}`)
  }
}
