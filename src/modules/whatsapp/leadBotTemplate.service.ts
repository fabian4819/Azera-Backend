import LeadBotTemplate from './leadBotTemplate.model'
import { LEAD_BOT_TRIGGERS, LeadBotTrigger } from './leadBotTemplate.model'
import { LEAD_BOT_DEFAULTS } from './leadBotDefaultTemplates'

/** Ambil body tersimpan untuk satu trigger — auto-seed dari default kalau belum ada */
export async function getLeadBotTemplate(trigger: LeadBotTrigger): Promise<string> {
  let tpl = await LeadBotTemplate.findOne({ trigger })
  if (!tpl) {
    tpl = await LeadBotTemplate.create({ trigger, body: LEAD_BOT_DEFAULTS[trigger].body })
  }
  return tpl.body
}

/** Pastikan semua trigger punya template tersimpan (dipanggil dari GET /admin/lead-bot-templates) */
export async function ensureAllLeadBotTemplates() {
  const existing = await LeadBotTemplate.find()
  const existingTriggers = new Set(existing.map((t) => t.trigger))
  const missing = LEAD_BOT_TRIGGERS.filter((t) => !existingTriggers.has(t))
  if (missing.length) {
    await LeadBotTemplate.insertMany(missing.map((trigger) => ({ trigger, body: LEAD_BOT_DEFAULTS[trigger].body })))
  }
  return LeadBotTemplate.find().sort({ trigger: 1 })
}
