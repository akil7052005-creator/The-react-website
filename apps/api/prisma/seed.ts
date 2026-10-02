import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { join } from 'path'
import { seedDemo } from './seed/demo'
import { seedReference } from './seed/reference'

// Reference data (plans, WhatsApp templates, FAQs) is always upserted.
// Demo data (studios and login accounts with the published demo passwords) is added unless
// SEED_DEMO=false, and never when NODE_ENV=production. Production uses `db:seed:prod` instead.
async function main() {
  const prisma = new PrismaClient()
  try {
    await seedReference(prisma)
    console.log('Reference data (plans, templates, FAQs) is up to date.')
    if (process.env.NODE_ENV === 'production') {
      console.log('NODE_ENV=production: skipped demo studios and accounts. Use `pnpm --filter @weddyzone/api db:seed:prod`.')
    } else if (process.env.SEED_DEMO !== 'false') {
      await seedDemo(prisma, process.env.UPLOAD_DIR ?? './uploads', join(__dirname, '../../web/src/assets'))
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
