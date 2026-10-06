import { Injectable } from '@nestjs/common'
import type { StudioDto } from '@weddyzone/shared'
import { notFound } from '../common/errors'
import { PrismaService } from '../prisma/prisma.service'
import { fileUrls } from './files.service'
import { PlansService } from './plans.service'

@Injectable()
export class StudioMapper {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
  ) {}

  async dto(studioId: string): Promise<StudioDto> {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      include: { users: { where: { role: 'OWNER' }, take: 1, orderBy: { createdAt: 'asc' } } },
    })
    if (!studio) throw notFound('Studio')
    const { plan } = await this.plans.effective(studioId)
    return {
      id: studio.id,
      name: studio.name,
      slug: studio.slug,
      ownerName: studio.users[0]?.name ?? '',
      email: studio.email,
      phone: studio.phone,
      city: studio.city,
      stateCode: studio.stateCode,
      addressLine1: studio.addressLine1,
      addressLine2: studio.addressLine2,
      pincode: studio.pincode,
      gstin: studio.gstin,
      pan: studio.pan,
      website: studio.website,
      instagramHandle: studio.instagramHandle,
      bio: studio.bio,
      logoUrl: studio.logoFileId ? fileUrls.public(studio.logoFileId) : null,
      referralCode: studio.referralCode,
      walletBalancePaise: studio.walletBalance,
      creditBalance: studio.creditBalance,
      plan: { code: plan.code, name: plan.name },
    }
  }
}
