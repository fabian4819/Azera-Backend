import { Types } from 'mongoose'
import DocumentModel from '../documents/document.model'
import { nextCounter } from './invoiceCounter.model'

/**
 * ID pendek invoice (#1, #2, ...) per tenant untuk perintah bot WA, terpisah dari nomor invoice yang panjang.
 * Diberikan urut tanggal dibuat; invoice lama dapat ID saat pertama kali dipanggil. Tidak pernah berubah /
 * dipakai ulang (counter atomik, invoice terhapus tidak mengembalikan nomornya).
 */
const running = new Map<string, Promise<void>>()

export function ensureInvoiceShortIds(tenantId: Types.ObjectId | string): Promise<void> {
  const key = String(tenantId)
  // Satu proses penomoran per tenant sekaligus, supaya dua request bersamaan tidak memberi 2 ID ke invoice yang sama
  const next = (running.get(key) ?? Promise.resolve()).then(async () => {
    const missing = await DocumentModel.find({ tenantId, type: 'invoice', shortId: { $exists: false } }).sort({ createdAt: 1, _id: 1 }).select('_id')
    for (const d of missing) {
      const id = await nextCounter(tenantId, 'invoice-short-id')
      await DocumentModel.updateOne({ _id: d._id, shortId: { $exists: false } }, { $set: { shortId: id } })
    }
  })
  running.set(key, next.catch(() => undefined))
  return next
}

/** "#12" / "12" → 12; selain itu null */
export const parseShortId = (v: string): number | null => {
  const m = /^#?(\d{1,6})$/.exec(v.trim())
  return m ? Number(m[1]) : null
}
