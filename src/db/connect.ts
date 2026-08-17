import mongoose from 'mongoose'
import { env } from '../config/env'

let isConnected = false

export async function connectDB() {
  if (isConnected) return
  await mongoose.connect(env.mongodbUri)
  isConnected = true
  console.log('MongoDB connected')
}
