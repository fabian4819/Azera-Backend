import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export interface IAuditLog extends Document {
  tenantId: Types.ObjectId
  userId: Types.ObjectId
  action: string
  entity: string
  entityId: Types.ObjectId
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  createdAt: Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

withTenant(AuditLogSchema)
AuditLogSchema.index({ tenantId: 1, entity: 1, entityId: 1 })
AuditLogSchema.index({ tenantId: 1, createdAt: -1 })

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema)
