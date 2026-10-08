import LeadBotTemplate from './leadBotTemplate.model'
import { LEAD_BOT_TRIGGERS, LeadBotTrigger } from './leadBotTemplate.model'
import { LEAD_BOT_DEFAULTS } from './leadBotDefaultTemplates'
import Tenant from '../tenants/tenant.model'
import { getDefaultTenant } from '../tenants/defaultTenant'
import { BotId, BOT_IDS } from './waTemplate.model'

/** Toggle bot balasan otomatis per bot, disimpan di Tenant default (bot lead memang single-tenant).
 *  Dibaca fresh tiap kali (bukan dari cache getDefaultTenant) supaya toggle langsung berlaku. */
export async function getAutoReplySettings(): Promise<Record<BotId, boolean>> {
  const tenant = await Tenant.findById((await getDefaultTenant())._id, 'settings.autoReply').lean()
  const saved = tenant?.settings?.autoReply
  return Object.fromEntries(BOT_IDS.map((b) => [b, saved?.[b] !== false])) as Record<BotId, boolean>
}

export async function setAutoReply(bot: BotId, enabled: boolean): Promise<void> {
  await Tenant.updateOne({ _id: (await getDefaultTenant())._id }, { [`settings.autoReply.${bot}`]: enabled })
}

/** Ambil body tersimpan untuk satu trigger, auto-seed dari default kalau belum ada */
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
