import { Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { PrismaService, type Tx } from '../prisma/prisma.service'

export interface AuditEntry {
  /** What happened, as `area.verb`, e.g. `faq.update`, `ticket.reply`, `auth.login`. */
  action: string
  target?: { type: string; id: string }
  /** One human-readable line, e.g. `Changed Studio yearly price to ₹59,990`. */
  summary: string
}

/** Append-only record of what platform admins did (and when they signed in). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(actorUserId: string, req: Pick<Request, 'ip'> | undefined, entry: AuditEntry, db: Tx | PrismaService = this.prisma) {
    await db.adminAuditLog.create({
      data: {
        actorUserId,
        action: entry.action,
        targetType: entry.target?.type,
        targetId: entry.target?.id,
        summary: entry.summary.slice(0, 500),
        ip: req?.ip ?? null,
      },
    })
  }
}
