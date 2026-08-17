import Tenant, { ITenant } from './tenant.model'
import { env } from '../../config/env'

/**
 * Deployment ini single-tenant (Azerakol) — lihat docs/plan/01-architecture.md.
 * Login belum punya JWT/tenant context, jadi tenant di-resolve dari slug
 * default yang dikonfigurasi lewat env, bukan lewat bypass tenant guard.
 * Kalau nanti multi-tenant beneran (subdomain per agency dsb), resolver ini
 * yang diganti — caller-nya (login routes) tidak perlu berubah.
 */
let cached: ITenant | null = null

export async function getDefaultTenant(): Promise<ITenant> {
  if (cached) return cached
  const tenant = await Tenant.findOne({ slug: env.defaultTenantSlug })
  if (!tenant) {
    throw new Error(`Default tenant "${env.defaultTenantSlug}" not found — run npm run seed first`)
  }
  cached = tenant
  return tenant
}
