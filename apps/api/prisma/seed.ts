import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { join } from 'path'
import { seedDemo } from './seed/demo'
import { seedReference } from './seed/reference'

// Reference data (plans, WhatsApp templates, FAQs) is always upserted.
// Demo data is added unless SEED_DEMO=false (set that in production).
async function main() {
  const prisma = new PrismaClient()
  try {
    await seedReference(prisma)
    console.log('Reference data (plans, templates, FAQs) is up to date.')
    if (process.env.SEED_DEMO !== 'false') {
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
