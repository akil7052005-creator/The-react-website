import { Injectable } from '@nestjs/common'
import type { CreditReason, WalletReason } from '@prisma/client'
import { insufficientCredits } from '../common/errors'
import type { Tx } from '../prisma/prisma.service'

/**
 * Append-only ledgers for WhatsApp credits and wallet money.
 * The balance column on Studio is updated in the same transaction as the
 * ledger row, with a conditional update so it can never go negative.
 */
@Injectable()
export class LedgerService {
  async applyCredits(
    tx: Tx,
    studioId: string,
    delta: number,
    reason: CreditReason,
    ref?: { type: string; id: string },
  ): Promise<number> {
    if (delta < 0) {
      const updated = await tx.studio.updateMany({
        where: { id: studioId, creditBalance: { gte: -delta } },
        data: { creditBalance: { increment: delta } },
      })
      if (updated.count === 0) {
        const s = await tx.studio.findUniqueOrThrow({ where: { id: studioId }, select: { creditBalance: true } })
        throw insufficientCredits(-delta, s.creditBalance)
      }
    } else {
      await tx.studio.update({ where: { id: studioId }, data: { creditBalance: { increment: delta } } })
    }
    const { creditBalance } = await tx.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { creditBalance: true },
    })
    await tx.creditLedger.create({
      data: { studioId, delta, reason, balanceAfter: creditBalance, refType: ref?.type, refId: ref?.id },
    })
    return creditBalance
  }

  /** Adds money to the studio wallet. `refId` + reason are unique per studio, so replays are no-ops. */
  async creditWallet(tx: Tx, studioId: string, deltaPaise: number, reason: WalletReason, refId: string) {
    const existing = await tx.walletTxn.findUnique({
      where: { studioId_reason_refId: { studioId, reason, refId } },
    })
    if (existing) return existing.balanceAfter
    const { walletBalance } = await tx.studio.update({
      where: { id: studioId },
      data: { walletBalance: { increment: deltaPaise } },
      select: { walletBalance: true },
    })
    await tx.walletTxn.create({ data: { studioId, delta: deltaPaise, reason, balanceAfter: walletBalance, refId } })
    return walletBalance
  }
}
