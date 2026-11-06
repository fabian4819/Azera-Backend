import { Schema, model, Document, Types } from 'mongoose'

/**
 * Creator kurasi yang sudah pernah ikut campaign SEBELUM ada platform (hasil menu Import Data).
 * Sengaja terpisah dari Creator (pendaftar platform/ekstensi) supaya tidak tercampur di menu Creators.
 * Dikenali dari No WA, atau username IG/TikTok kalau WA kosong (banyak creator kurasi cuma punya TikTok);
 * import ulang melengkapi data, bukan menggandakan.
 */
export interface IExistingSocial { username?: string; url?: string; followers?: number }

export interface IExistingCreator extends Document {
  tenantId: Types.ObjectId
  name: string
  phone?: string
  /** Kunci pencocokan username (huruf kecil): 'ig:<username>', 'tt:<username>' */
  handles: string[]
  age?: number
  domicile?: string
  gender?: string
  niches: string[]
  instagram?: IExistingSocial
  tiktok?: IExistingSocial
  /** Catatan kurasi dari kolom Approval, mis. "Engagement OK, Profil OK" */
  approval?: string
  createdAt: Date
  updatedAt: Date
}

const SocialSchema = new Schema<IExistingSocial>({ username: String, url: String, followers: Number }, { _id: false })

const ExistingCreatorSchema = new Schema<IExistingCreator>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true },
    phone: String,
    handles: { type: [String], default: [] },
    age: Number,
    domicile: String,
    gender: String,
    niches: { type: [String], default: [] },
    instagram: SocialSchema,
    tiktok: SocialSchema,
    approval: String,
  },
  { timestamps: true }
)
ExistingCreatorSchema.index({ tenantId: 1, phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } })
ExistingCreatorSchema.index({ tenantId: 1, handles: 1 })

export default model<IExistingCreator>('ExistingCreator', ExistingCreatorSchema)
