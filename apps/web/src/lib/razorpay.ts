import type { GatewayCheckoutDto, PaymentDto } from '@weddyzone/shared'
import { api } from './api'

/** Razorpay's Checkout script (loaded once, only when someone pays). */
const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

interface RazorpaySuccess {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}
interface RazorpayInstance {
  open(): void
  on(event: 'payment.failed', handler: (r: { error?: { description?: string } }) => void): void
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance

declare global {
  interface Window {
    Razorpay?: RazorpayCtor
  }
}

let loading: Promise<RazorpayCtor> | null = null

function loadCheckout(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay did not load')))
    script.onerror = () => {
      loading = null
      script.remove()
      reject(new Error("Couldn't load the payment window. Check your connection and try again."))
    }
    document.head.appendChild(script)
  })
  return loading
}

export type CheckoutOutcome = { status: 'paid'; payment: PaymentDto } | { status: 'closed' }

/**
 * Opens Razorpay Checkout for a pending payment. Resolves "paid" once the server has confirmed it
 * with Razorpay (the plan, credits or add-on are then applied), or "closed" if the studio closes the
 * window without paying. A failed attempt stays in the window so the studio can try another way.
 */
export async function payWithRazorpay(c: GatewayCheckoutDto, onFailedAttempt?: (reason: string) => void): Promise<CheckoutOutcome> {
  const Razorpay = await loadCheckout()
  return new Promise<CheckoutOutcome>((resolve, reject) => {
    const rzp = new Razorpay({
      key: c.keyId,
      order_id: c.orderId,
      amount: c.amountPaise,
      currency: c.currency,
      name: c.name,
      description: c.description,
      prefill: c.prefill,
      notes: { paymentId: c.paymentId },
      theme: { color: '#e0144a' },
      handler: (r: RazorpaySuccess) => {
        api
          .post<{ payment: PaymentDto }>(`/subscription/payments/${c.paymentId}/verify`, {
            razorpayPaymentId: r.razorpay_payment_id,
            razorpayOrderId: r.razorpay_order_id,
            razorpaySignature: r.razorpay_signature,
          })
          .then((res) => resolve({ status: 'paid', payment: res.payment }), reject)
      },
      modal: { ondismiss: () => resolve({ status: 'closed' }), confirm_close: true },
    })
    rzp.on('payment.failed', (r) => onFailedAttempt?.(r.error?.description ?? 'The payment did not go through'))
    rzp.open()
  })
}
