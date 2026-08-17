import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { connectDB } from './db/connect'
import Tenant from './modules/tenants/tenant.model'
import User from './modules/users/user.model'

const OWNER_EMAIL = 'admin@azerakol.id'
const OWNER_PASSWORD = 'Azera@Admin2026'

async function seed() {
  await connectDB()

  let tenant = await Tenant.findOne({ slug: 'azerakol' })
  if (!tenant) {
    tenant = await Tenant.create({
      name: 'Azerakol',
      slug: 'azerakol',
      settings: { waNumber: '081919525186', contactEmail: 'hello@azerakol.id' },
    })
    console.log('Tenant seeded: azerakol')
  }

  const existingOwner = await User.findOne({ tenantId: tenant._id, email: OWNER_EMAIL })
  if (existingOwner) {
    console.log('Owner already exists')
  } else {
    const password = await bcrypt.hash(OWNER_PASSWORD, 12)
    await User.create({
      tenantId: tenant._id,
      email: OWNER_EMAIL,
      password,
      name: 'Azza',
      role: 'owner',
    })
    console.log(`Owner seeded: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`)
  }

  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
