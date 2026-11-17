import type { Types } from 'mongoose'

/**
 * Satu Application = satu baris. Campaign buzzer: satu creator bisa punya beberapa baris (satu per akun),
 * jadi submission & tampilan akun harus per Application, bukan per creator.
 */
type AppRef = { _id: unknown; tenantId: Types.ObjectId | string; campaignId: Types.ObjectId | string; creatorId: unknown; account?: { platform: string; username: string; followers?: number } | null }

/** Filter Submission milik baris ini. Submission lama (sebelum ada applicationId) ikut lewat creatorId. */
export function submissionFilterFor(app: AppRef) {
  return {
    tenantId: app.tenantId,
    campaignId: app.campaignId,
    $or: [{ applicationId: app._id }, { applicationId: { $exists: false }, creatorId: app.creatorId }],
  }
}

/** Submission ini milik baris `app`? (versi in-memory dari submissionFilterFor) */
export const submissionBelongsTo = (s: { applicationId?: unknown; creatorId: unknown }, app: AppRef) =>
  s.applicationId ? String(s.applicationId) === String(app._id) : String(s.creatorId) === String(app.creatorId)

/** Data creator untuk baris ini: baris buzzer cuma menampilkan akun miliknya (platform lain kosong). */
export function creatorViewFor<C extends { socials?: unknown[] }>(creator: C | null | undefined, app: AppRef): C | null {
  if (!creator) return null
  if (!app.account?.username) return creator
  const plain = (typeof (creator as { toObject?: () => C }).toObject === 'function' ? (creator as unknown as { toObject: () => C }).toObject() : { ...creator }) as C
  return { ...plain, socials: [{ ...app.account }] }
}

/** Snapshot ekstensi (per creator+platform) cuma dipakai di baris buzzer kalau username-nya sama dengan akun baris itu */
export const snapshotMatches = (snap: { username?: string } | undefined, app: AppRef) =>
  Boolean(snap) && (!app.account?.username || String(snap!.username || '').replace(/^@+/, '').toLowerCase() === app.account.username.toLowerCase())
