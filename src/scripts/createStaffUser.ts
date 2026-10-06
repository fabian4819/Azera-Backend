/**
 * Buat akun staff (login /admin/login) — belum ada UI manajemen user.
 *   npx tsx src/scripts/createStaffUser.ts <email> <role> "<nama>"
 * Role: owner | admin | ce | finance | developer. Password digenerate & dicetak sekali.
 * Kalau email sudah ada, akun tidak diubah (aman dijalankan ulang).
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { connectDB } from '../db/connect'
import { getDefaultTenant } from '../modules/tenants/defaultTenant'
import User, { UserRole } from '../modules/users/user.model'

const ROLES: UserRole[] = ['owner', 'admin', 'ce', 'finance', 'developer']

async function main() {
  const [email, role, name] = process.argv.slice(2)
  if (!email || !ROLES.includes(role as UserRole) || !name) {
    console.error('Usage: npx tsx src/scripts/createStaffUser.ts <email> <owner|admin|ce|finance|developer> "<nama>"')
    process.exit(1)
  }
  await connectDB()
  const tenant = await getDefaultTenant()
  const existing = await User.findOne({ tenantId: tenant._id, email: email.toLowerCase() })
  if (existing) {
    console.log(`Akun ${email} sudah ada (role ${existing.role}) — tidak diubah.`)
  } else {
    const password = crypto.randomBytes(9).toString('base64url')
    await User.create({ tenantId: tenant._id, email: email.toLowerCase(), name, role, password: await bcrypt.hash(password, 12) })
    console.log(`Akun dibuat: ${email} (role ${role})\nPassword: ${password}`)
  }
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
