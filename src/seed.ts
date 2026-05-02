import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { connectDB } from './lib/db'
import Admin from './models/Admin'

async function seed() {
  await connectDB()
  const existing = await Admin.findOne({ email: 'admin@azerakol.id' })
  if (existing) { console.log('Admin already exists'); process.exit(0) }
  const password = await bcrypt.hash('Azera@Admin2026', 12)
  await Admin.create({ email: 'admin@azerakol.id', password, name: 'Azera Admin' })
  console.log('Admin seeded: admin@azerakol.id / Azera@Admin2026')
  process.exit(0)
}

seed().catch(console.error)
