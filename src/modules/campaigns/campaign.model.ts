import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/**
 * 17-tahap workflow (ACC klien 16 Agu 2026) — lihat docs/plan/modul-4-automation-workflow.md
 */
export const WORKFLOW_STAGES = [
  'draft',
  'listing',
  'open_registration',
  'internal_review',
  'smart_recommendation',
  'creator_approved',
  'client_approval',
  'brief_sent',
  'waiting_draft',
  'content_review',
  'revision',
  'waiting_post',
  'posted',
  'waiting_insight',
  'insight_collected',
  'report_generated',
  'completed',
] as const

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]

/**
 * AD-47: pertanyaan tambahan custom per campaign di form Apply, ala Google Forms.
 * Field inti (nama/WA/gender/domisili/sosmed/dst) tetap tersimpan di Creator —
 * ini murni pertanyaan EKSTRA yang ditambahkan admin, jawabannya masuk ke
 * Application.customAnswers (lihat application.model.ts), tidak menggantikan
 * field inti supaya Smart Curation (yang baca dari Creator, bukan dari sini)
 * tidak perlu berubah.
 */
export type CustomFieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox'

export interface ICustomField {
  id: string
  label: string
  type: CustomFieldType
  required: boolean
  /** Dipakai untuk type 'select' (pilih satu) & 'checkbox' (bisa lebih dari satu) */
  options?: string[]
}

export interface ICampaign extends Document {
  tenantId: Types.ObjectId
  brandId: Types.ObjectId
  name: string
  objective: string
  deliverables: string[]
  budget: number
  timeline: { startDate?: Date; endDate?: Date }
  criteria: {
    niches: string[]
    minFollowers?: number
    provinces: string[]
    platforms: string[]
  }
  type: 'online' | 'offline'
  eventDetails?: { location: string; date: Date; timeWindow: string }
  picUserId?: Types.ObjectId
  handleByUserId?: Types.ObjectId
  accessCode: string
  fee: {
    creatorFee?: number
    picFee?: number
    mgFee?: number
    reimburse?: number
    ads?: number
    opex?: number
    discount?: number
  }
  briefContent?: string
  /** Link grup WA campaign — dikirim ke creator saat diterima (AD-30, trigger creator_accepted) */
  waGroupLink?: string
  /** Target KPI campaign (AD-23/24) — opsional, dipakai buat hitung % pencapaian di analytics/insight */
  targetKpi?: { views?: number; engagementRate?: number }
  /** AD-24: analisis AI setelah campaign selesai — jadi input untuk Auto Report (AD-26) */
  aiInsight?: string
  workflowStage: WorkflowStage
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  applyOpen: boolean
  applySlug: string
  /** AD-47: pertanyaan tambahan custom di form Apply, diisi admin lewat CampaignDetail */
  customFields: ICustomField[]
  createdAt: Date
  updatedAt: Date
}

const CustomFieldSchema = new Schema<ICustomField>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ['text', 'textarea', 'number', 'select', 'checkbox'], required: true },
    required: { type: Boolean, default: false },
    options: [String],
  },
  { _id: false }
)

const CampaignSchema = new Schema<ICampaign>(
  {
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', required: true },
    name: { type: String, required: true },
    objective: { type: String, required: true },
    deliverables: [String],
    budget: { type: Number, required: true },
    timeline: {
      startDate: Date,
      endDate: Date,
    },
    criteria: {
      niches: [String],
      minFollowers: Number,
      provinces: [String],
      platforms: [String],
    },
    type: { type: String, enum: ['online', 'offline'], default: 'online' },
    eventDetails: {
      location: String,
      date: Date,
      timeWindow: String,
    },
    picUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    handleByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    accessCode: { type: String, required: true },
    fee: {
      creatorFee: Number,
      picFee: Number,
      mgFee: Number,
      reimburse: Number,
      ads: Number,
      opex: Number,
      discount: Number,
    },
    briefContent: String,
    waGroupLink: String,
    targetKpi: {
      views: Number,
      engagementRate: Number,
    },
    aiInsight: String,
    workflowStage: { type: String, enum: WORKFLOW_STAGES, default: 'draft' },
    status: { type: String, enum: ['draft', 'active', 'completed', 'cancelled'], default: 'draft' },
    applyOpen: { type: Boolean, default: false },
    applySlug: { type: String, required: true },
    customFields: { type: [CustomFieldSchema], default: [] },
  },
  { timestamps: true }
)

withTenant(CampaignSchema)
CampaignSchema.index({ tenantId: 1, applySlug: 1 }, { unique: true })

export default mongoose.model<ICampaign>('Campaign', CampaignSchema)
