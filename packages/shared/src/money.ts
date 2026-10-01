// Money is stored and returned by the API as integer paise.
// Request bodies carry rupees (max 2 decimals), converted with toPaise().

export function toPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

export function toRupees(paise: number): number {
  return paise / 100
}

export function formatINR(paise: number, opts: { decimals?: boolean } = {}): string {
  const rupees = paise / 100
  const decimals = opts.decimals ?? !Number.isInteger(rupees)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(rupees)
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? `${ONES[h]} Hundred` : '', r ? belowHundred(r) : ''].filter(Boolean).join(' ')
}

/** Indian numbering in words, e.g. 11800000 paise → "Rupees One Lakh Eighteen Thousand Only". */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const p = paise % 100
  const parts: string[] = []
  let n = rupees
  const crore = Math.floor(n / 10_000_000)
  n %= 10_000_000
  const lakh = Math.floor(n / 100_000)
  n %= 100_000
  const thousand = Math.floor(n / 1000)
  n %= 1000
  if (crore) parts.push(`${belowThousand(crore)} Crore`)
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`)
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`)
  if (n) parts.push(belowThousand(n))
  const words = parts.length ? parts.join(' ') : 'Zero'
  return `Rupees ${words}${p ? ` and ${belowHundred(p)} Paise` : ''} Only`
}
