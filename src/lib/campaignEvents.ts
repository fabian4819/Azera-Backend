import { EventEmitter } from 'events'

/** Sinyal "data pendaftaran campaign ini berubah" untuk halaman admin yang sedang terbuka (SSE).
 * ponytail: EventEmitter di memori = cuma jalan untuk 1 proses API (deploy sekarang 1 container);
 * kalau API di-scale > 1 instance, ganti ke Redis pub/sub. */
const bus = new EventEmitter()
bus.setMaxListeners(0)

export function emitCampaignChange(campaignId: unknown): void {
  bus.emit(String(campaignId))
}

export function onCampaignChange(campaignId: string, fn: () => void): () => void {
  bus.on(campaignId, fn)
  return () => { bus.off(campaignId, fn) }
}
