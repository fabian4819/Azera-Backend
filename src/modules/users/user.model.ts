import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

export type UserRole = 'owner' | 'admin' | 'ce' | 'finance'

export interface IUser extends Document {
  tenantId: Types.ObjectId
  name: string
  email: string
  password: string
  phone?: string
  role: UserRole
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    phone: String,
    role: { type: String, enum: ['owner', 'admin', 'ce', 'finance'], required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

withTenant(UserSchema)
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true })

export default mongoose.model<IUser>('User', UserSchema)
