import { Injectable } from '@nestjs/common'
import type { Notification } from '@prisma/client'
import type { NotificationDto, NotificationType } from '@weddyzone/shared'
import { PrismaService, type Tx } from '../prisma/prisma.service'

export interface NewNotification {
  type: NotificationType
  title: string
  body: string
  link?: string
  icon?: string
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(studioId: string, n: NewNotification, db: Tx | PrismaService = this.prisma) {
    await db.notification.create({
      data: { studioId, type: n.type, title: n.title, body: n.body, link: n.link, icon: n.icon ?? 'bell' },
    })
  }

  toDto(n: Notification): NotificationDto {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      icon: n.icon,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }
  }
}
