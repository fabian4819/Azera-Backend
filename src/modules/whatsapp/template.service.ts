import { Types } from 'mongoose'
import WaTemplate from './waTemplate.model'
import { WaTrigger, WA_TRIGGERS } from './waTemplate.model'
import { DEFAULT_TEMPLATES } from './defaultTemplates'

/** Ganti placeholder {{key}} dengan value dari vars — key tidak ditemukan dibiarkan kosong */
export function renderTemplate(body: string, vars: Record<string, string | number | undefined>): string {
  return body.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => {
    const value = vars[key]
    return value === undefined || value === null ? '' : String(value)
  })
}

/** Ambil template tenant untuk trigger tertentu — auto-seed dari default kalau belum ada */
export async function getTemplate(tenantId: string | Types.ObjectId, trigger: WaTrigger): Promise<string> {
  let tpl = await WaTemplate.findOne({ tenantId, trigger })
  if (!tpl) {
    const def = DEFAULT_TEMPLATES[trigger]
    tpl = await WaTemplate.create({ tenantId, trigger, audience: def.audience, body: def.body })
  }
  return tpl.body
}

/** Pastikan semua 15 trigger punya template tersimpan untuk tenant (dipanggil dari GET /admin/wa-templates) */
export async function ensureAllTemplates(tenantId: string | Types.ObjectId) {
  const existing = await WaTemplate.find({ tenantId })
  const existingTriggers = new Set(existing.map((t) => t.trigger))
  const missing = WA_TRIGGERS.filter((t) => !existingTriggers.has(t))
  if (missing.length) {
    await WaTemplate.insertMany(
      missing.map((trigger) => ({
        tenantId,
        trigger,
        audience: DEFAULT_TEMPLATES[trigger].audience,
        body: DEFAULT_TEMPLATES[trigger].body,
      }))
    )
  }
  return WaTemplate.find({ tenantId }).sort({ audience: 1, trigger: 1 })
}
