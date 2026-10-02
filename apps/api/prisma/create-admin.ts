import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'

/**
 * Creates a platform admin (SUPER_ADMIN), or gives an existing admin a new password.
 * The password is random and shown once; it is never stored anywhere but as a bcrypt hash.
 *
 *   pnpm --filter @weddyzone/api admin:create -- --email you@yourdomain.com --name "Your Name"
 *   pnpm --filter @weddyzone/api admin:create -- --email you@yourdomain.com --reset-password
 */
export async function createAdmin(
  prisma: PrismaClient,
  opts: { email: string; name?: string; resetPassword?: boolean },
): Promise<{ email: string; password: string; created: boolean }> {
  const email = opts.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Not a valid email address: ${opts.email}`)
  const password = randomBytes(18).toString('base64url') // 24 characters, ~144 bits
  const passwordHash = await bcrypt.hash(password, 12)
  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    if (existing.role !== 'SUPER_ADMIN') {
      throw new Error(`${email} is a studio account. Use a separate email address for the admin.`)
    }
    if (!opts.resetPassword) throw new Error(`${email} is already an admin. Add --reset-password to give it a new password.`)
    await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data: { passwordHash } }),
      // Sign the admin out everywhere: old sessions must not outlive the old password.
      prisma.refreshToken.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ])
    return { email, password, created: false }
  }

  const name = opts.name?.trim()
  if (!name) throw new Error('Add --name "Full Name" for a new admin.')
  await prisma.user.create({ data: { email, name, role: 'SUPER_ADMIN', passwordHash, studioId: null } })
  return { email, password, created: true }
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (require.main === module) {
  const email = arg('email')
  if (!email) {
    console.error('Usage: admin:create -- --email you@yourdomain.com --name "Full Name"  [--reset-password]')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  createAdmin(prisma, { email, name: arg('name'), resetPassword: process.argv.includes('--reset-password') })
    .then(({ email: e, password, created }) => {
      console.log(`\n${created ? 'Admin created' : 'Admin password reset (all sessions signed out)'}: ${e}`)
      console.log(`Password (shown once, store it in a password manager): ${password}\n`)
    })
    .catch((e: Error) => {
      console.error(e.message)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
