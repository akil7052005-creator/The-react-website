import { createHmac } from 'crypto'

/** Razorpay test keys the fake accepts (nothing leaves the machine). */
export const KEY_ID = 'rzp_test_fake123'
export const KEY_SECRET = 'fake-key-secret'

/** An in-memory Razorpay: orders, payments, capture. Nothing leaves the machine. */
export function fakeRazorpay() {
  const orders = new Map<string, { id: string; amount: number; receipt: string }>()
  const payments = new Map<string, { id: string; order_id: string; amount: number; currency: string; status: string }>()
  const calls: string[] = []
  let down = false
  let n = 0
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${u.pathname}`)
    if (down) return json(500, { error: { description: 'Server error' } })
    const auth = new Headers(init?.headers).get('Authorization')
    if (auth !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`) return json(401, { error: { description: 'Authentication failed' } })
    if (method === 'POST' && u.pathname === '/v1/orders') {
      const body = JSON.parse(String(init?.body)) as { amount: number; receipt: string; currency: string }
      expect(body.currency).toBe('INR')
      const order = { id: `order_fake${++n}`, amount: body.amount, receipt: body.receipt }
      orders.set(order.id, order)
      return json(200, order)
    }
    const pay = u.pathname.match(/^\/v1\/payments\/([^/]+)(\/capture)?$/)
    if (pay) {
      const p = payments.get(decodeURIComponent(pay[1]))
      if (!p) return json(404, { error: { description: 'No such payment' } })
      if (pay[2] && method === 'POST') {
        if (p.status !== 'authorized') return json(400, { error: { description: 'This payment has already been captured' } })
        p.status = 'captured'
      }
      return json(200, p)
    }
    return json(404, { error: { description: 'Unknown endpoint' } })
  }) as typeof fetch
  /** The studio pays the order in Checkout (Razorpay holds it "authorized" until captured, unless auto-capture is on). */
  const pay = (orderId: string, status: 'authorized' | 'captured' = 'authorized', amount?: number) => {
    const order = orders.get(orderId)!
    const id = `pay_fake${++n}`
    payments.set(id, { id, order_id: orderId, amount: amount ?? order.amount, currency: 'INR', status })
    const signature = createHmac('sha256', KEY_SECRET).update(`${orderId}|${id}`).digest('hex')
    return { razorpayPaymentId: id, razorpayOrderId: orderId, razorpaySignature: signature }
  }
  return {
    http,
    orders,
    payments,
    calls,
    pay,
    setDown: (v: boolean) => {
      down = v
    },
  }
}
