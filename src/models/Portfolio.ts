import mongoose, { Schema, Document } from 'mongoose'

export interface IPortfolio extends Document {
  brand: string
  logo: string
  hashtag: string
  category: string
  kolCount: number
  reach: string
  engagement: string
  contents: string[]
  featured: boolean
  createdAt: Date
  updatedAt: Date
}

const PortfolioSchema = new Schema<IPortfolio>(
  {
    brand: { type: String, required: true },
    logo: { type: String, required: true },
    hashtag: { type: String, required: true },
    category: { type: String, required: true },
    kolCount: { type: Number, required: true },
    reach: { type: String, required: true },
    engagement: { type: String, required: true },
    contents: [String],
    featured: { type: Boolean, default: false },
  },
  { timestamps: true }
)

export default mongoose.model<IPortfolio>('Portfolio', PortfolioSchema)
