import { Schema, Types } from 'mongoose'
import { env } from '../config/env'

/**
 * Adds a required tenantId field to a schema and guards every find/update/delete
 * query to require a tenantId filter. Prevents accidentally leaking data across
 * tenants when a route forgets to scope its query.
 *
 * In non-production, a query without tenantId throws immediately instead of
 * silently returning cross-tenant data — catches the mistake in dev.
 */
export function withTenant(schema: Schema) {
  schema.add({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  })

  const queryMiddleware = function (this: any, next: (err?: Error) => void) {
    const filter = this.getFilter()
    if (!filter.tenantId && !filter._id) {
      const message = 'Tenant-scoped query missing tenantId filter'
      if (!env.isProd) {
        next(new Error(message))
        return
      }
      console.error(message, { model: this.model?.modelName, filter })
    }
    next()
  }

  schema.pre(/^find/, queryMiddleware)
  schema.pre('countDocuments', queryMiddleware)
  schema.pre('deleteMany', queryMiddleware)
  schema.pre('updateMany', queryMiddleware)
}

export type TenantId = Types.ObjectId | string
