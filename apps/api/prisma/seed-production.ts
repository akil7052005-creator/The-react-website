import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { seedReference } from './seed/reference'

// Production seed: only the reference data the app needs (plans, WhatsApp templates, FAQs).
// It never creates studios, users or passwords, and is safe to run again (plans and templates are
// upserted; FAQs are only added when there are none).
async function main() {
  const prisma = new PrismaClient()
  try {
    await seedReference(prisma)
    const [plans, templates, faqs, users] = await Promise.all([
      prisma.plan.count(),
      prisma.whatsAppTemplate.count(),
      prisma.faq.count(),
      prisma.user.count(),
    ])
    console.log(`Reference data is up to date: ${plans} plans, ${templates} WhatsApp templates, ${faqs} FAQs.`)
    console.log(`No accounts were created (the database has ${users} user account(s)).`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
