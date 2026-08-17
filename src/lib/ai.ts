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

const INSIGHT_PARSE_INSTRUCTION =
  'Baca screenshot insight media sosial ini. Kembalikan JSON dengan field: views, likes, comments, shares, saves, reach (angka, null jika tidak terlihat). Hanya JSON, tanpa penjelasan.'

export async function parseInsightScreenshot(imageUrl: string): Promise<ParsedInsight> {
  switch (env.ai.visionProvider) {
    case 'gemini':
      return parseImageGemini(imageUrl, INSIGHT_PARSE_INSTRUCTION)
    default:
      throw new Error(`Unsupported AI_VISION_PROVIDER: ${env.ai.visionProvider}`)
  }
}
