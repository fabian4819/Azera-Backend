import mongoose, { Schema, Document, Types } from 'mongoose'
import { withTenant } from '../../db/tenantPlugin'

/**
 * 17-tahap workflow (ACC klien 16 Agu 2026), lihat docs/plan/modul-4-automation-workflow.md
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
 * Field inti (nama/WA/gender/domisili/sosmed/dst) tetap tersimpan di Creator,
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

/**
 * Field default form Apply. Nama/WA/Email selalu ada & wajib (tidak bisa dihapus admin).
 * PIC & Handle by default aktif, admin boleh mematikan per campaign.
 */
export interface IApplyFields {
  pic: boolean
  handleBy: boolean
  handleByRequired: boolean
}

/** Akses creator ke satu kolom di tabel portal (magic link). 'edit' cuma berlaku untuk kolom progress. */
export type CreatorAccess = 'hidden' | 'view' | 'edit'

/** Field Submission yang bisa diikat ke kolom progress, isinya ditulis ke Submission (bukan
 * disimpan terpisah) supaya Report, analytics, workflow & ekstensi tetap baca dari sumber yang sama. */
export const SUBMISSION_FIELDS = ['link', 'postedAt', 'views', 'likes', 'comments', 'shares', 'saves', 'reach', 'screenshots'] as const
export type SubmissionField = (typeof SUBMISSION_FIELDS)[number]
export const PROGRESS_TYPES = ['text', 'number', 'date', 'link'] as const
export type ProgressType = (typeof PROGRESS_TYPES)[number]

/**
 * Kolom tambahan di Master Sheet yang dibuat admin. Tanpa `submission` = kolom bebas (nilai di
 * Application.progress). Dengan `submission` = nilai dibaca/ditulis ke Submission creator itu
 * untuk tipe+platform tsb (1 baris per creator, makanya beda platform = beda kolom).
 */
export interface IProgressColumn {
  id: string
  label: string
  type: ProgressType
  submission?: { type: 'draft' | 'post'; platform: 'instagram' | 'tiktok' | 'threads' | 'x'; field: SubmissionField }
  creatorAccess: CreatorAccess
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
    /** Lama (satu angka untuk semua platform), masih dibaca untuk campaign lama */
    minFollowers?: number
    /** Min. followers per platform yang dicentang */
    minFollowersByPlatform?: Partial<Record<'instagram' | 'tiktok' | 'threads' | 'x', number>>
    provinces: string[]
    /** Opsional, kota/kabupaten target (dicocokkan tanpa awalan Kota/Kabupaten) */
    cities?: string[]
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
  /** Info listing untuk Broadcast Campaign (lihat client/src/lib/broadcast.ts) */
  feeNote?: string
  benefits: string[]
  requirements: string[]
  infoLink?: string
  briefContent?: string
  /** Link grup WA campaign, dikirim ke creator saat diterima (AD-30, trigger creator_accepted) */
  waGroupLink?: string
  /** Target KPI campaign (AD-23/24), opsional, dipakai buat hitung % pencapaian di analytics/insight */
  targetKpi?: { views?: number; engagementRate?: number }
  /** AD-24: analisis AI setelah campaign selesai, jadi input untuk Auto Report (AD-26) */
  aiInsight?: string
  workflowStage: WorkflowStage
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  applyOpen: boolean
  applySlug: string
  /** AD-47: pertanyaan tambahan custom di form Apply, diisi admin lewat CampaignDetail */
  customFields: ICustomField[]
  applyFields: IApplyFields
  progressColumns: IProgressColumn[]
  /** Akses creator ke kolom non-progress di tabel portal (key = columnKey di sheetSync.service.ts).
   * Tidak ada entry = pakai default (lihat DEFAULT_VIEW_COLUMNS). Nilai 'edit' diperlakukan 'view'. */
  columnAccess: Map<string, CreatorAccess>
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

const SubmissionBindSchema = new Schema(
  {
    type: { type: String, enum: ['draft', 'post'], required: true },
    platform: { type: String, enum: ['instagram', 'tiktok', 'threads', 'x'], required: true },
    field: { type: String, enum: SUBMISSION_FIELDS, required: true },
  },
  { _id: false }
)

const ProgressColumnSchema = new Schema<IProgressColumn>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: PROGRESS_TYPES, default: 'text' },
    submission: { type: SubmissionBindSchema, default: undefined },
    creatorAccess: { type: String, enum: ['hidden', 'view', 'edit'], default: 'edit' },
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
      minFollowersByPlatform: { instagram: Number, tiktok: Number, threads: Number, x: Number },
      provinces: [String],
      cities: [String],
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
    feeNote: String,
    benefits: [String],
    requirements: [String],
    infoLink: String,
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
    applyFields: {
      pic: { type: Boolean, default: true },
      handleBy: { type: Boolean, default: true },
      handleByRequired: { type: Boolean, default: false },
    },
    progressColumns: { type: [ProgressColumnSchema], default: [] },
    columnAccess: { type: Map, of: { type: String, enum: ['hidden', 'view', 'edit'] }, default: {} },
  },
  { timestamps: true }
)

withTenant(CampaignSchema)
CampaignSchema.index({ tenantId: 1, applySlug: 1 }, { unique: true })

export default mongoose.model<ICampaign>('Campaign', CampaignSchema)
