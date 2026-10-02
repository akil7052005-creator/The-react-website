import type { Payment, Studio } from '@prisma/client'
import { amountInWords, type PlatformInvoiceDto } from '@weddyzone/shared'
import { config } from '../config'

/** SAC for online information / software services (subscriptions to the platform). */
const PLATFORM_SAC = '998314'

/**
 * Weddyzone's GST tax invoice for one paid plan payment. CGST + SGST when the studio is in the
 * platform's state (PLATFORM_STATE_CODE), IGST otherwise. Shared by the studio and admin views.
 */
export function platformInvoiceDto(p: Payment & { studio: Studio }): PlatformInvoiceDto {
  const c = config()
  const taxable = p.amount - p.gst
  const intra = !!c.PLATFORM_STATE_CODE && c.PLATFORM_STATE_CODE === p.studio.stateCode
  const half = Math.floor(p.gst / 2)
  const address = [p.studio.addressLine1, p.studio.addressLine2, p.studio.city, p.studio.pincode].filter(Boolean).join(', ')
  return {
    number: p.invoiceNumber!,
    date: (p.paidAt ?? p.createdAt).toISOString(),
    seller: { name: c.PLATFORM_LEGAL_NAME, gstin: c.PLATFORM_GSTIN ?? null, address: c.PLATFORM_ADDRESS ?? null, stateCode: c.PLATFORM_STATE_CODE ?? null },
    buyer: { name: p.studio.name, gstin: p.studio.gstin, address: address || null, stateCode: p.studio.stateCode, email: p.studio.email },
    description: p.description,
    sac: PLATFORM_SAC,
    taxablePaise: taxable,
    cgstPaise: intra ? half : 0,
    sgstPaise: intra ? p.gst - half : 0,
    igstPaise: intra ? 0 : p.gst,
    totalPaise: p.amount,
    totalInWords: amountInWords(p.amount),
    paymentRef: p.gatewayPaymentId,
  }
}
