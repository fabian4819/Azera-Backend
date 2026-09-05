import { connectDB } from '../../db/connect'
import { getDefaultTenant } from '../tenants/defaultTenant'
import WaContact from './waContact.model'
import WaChatMessage from './waChatMessage.model'

const PREVIEW_LEN = 80

export async function recordIncomingMessage(jid: string, text: string, messageId?: string) {
  await connectDB()
  const tenant = await getDefaultTenant()
  await WaChatMessage.create({ tenantId: tenant._id, jid, direction: 'in', text, messageId })
  await WaContact.findOneAndUpdate(
    { tenantId: tenant._id, jid },
    {
      $set: { lastMessageAt: new Date(), lastMessagePreview: text.slice(0, PREVIEW_LEN) },
      $inc: { unreadCount: 1 },
      $setOnInsert: { botPaused: false },
    },
    { upsert: true }
  )
}

export async function recordOutgoingMessage(jid: string, text: string) {
  await connectDB()
  const tenant = await getDefaultTenant()
  await WaChatMessage.create({ tenantId: tenant._id, jid, direction: 'out', text })
  await WaContact.findOneAndUpdate(
    { tenantId: tenant._id, jid },
    {
      $set: { lastMessageAt: new Date(), lastMessagePreview: text.slice(0, PREVIEW_LEN) },
      $setOnInsert: { botPaused: false, unreadCount: 0 },
    },
    { upsert: true }
  )
}

export async function isBotPaused(jid: string): Promise<boolean> {
  await connectDB()
  const tenant = await getDefaultTenant()
  const contact = await WaContact.findOne({ tenantId: tenant._id, jid })
  return contact?.botPaused ?? false
}
