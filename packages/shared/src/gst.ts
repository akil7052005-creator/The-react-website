// GST maths shared by the invoice form (live totals) and the API (stored totals),
// so what the studio sees while typing is exactly what gets saved.
//
// Rules:
// - Line taxable value = qty × rate (paise).
// - Intra-state (studio state = place of supply): CGST and SGST, each at half the rate.
// - Inter-state: IGST at the full rate.
// - Tax is rounded to the nearest paisa per line and per component.

export type SupplyType = 'INTRA' | 'INTER'

export interface GstLineInput {
  qty: number
  ratePaise: number
  gstRate: number
}

export interface GstLineResult {
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
}

export interface GstTotals {
  supplyType: SupplyType
  lines: GstLineResult[]
  subtotalPaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  taxPaise: number
  totalPaise: number
}

export function supplyTypeFor(studioStateCode: string | null | undefined, placeOfSupply: string): SupplyType {
  return studioStateCode && studioStateCode === placeOfSupply ? 'INTRA' : 'INTER'
}

export function computeLine(line: GstLineInput, supplyType: SupplyType): GstLineResult {
  const taxablePaise = Math.round(line.qty * line.ratePaise)
  if (supplyType === 'INTRA') {
    const half = Math.round((taxablePaise * line.gstRate) / 200)
    return { taxablePaise, cgstPaise: half, sgstPaise: half, igstPaise: 0, totalPaise: taxablePaise + 2 * half }
  }
  const igst = Math.round((taxablePaise * line.gstRate) / 100)
  return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: igst, totalPaise: taxablePaise + igst }
}

export function computeInvoiceTotals(
  lines: GstLineInput[],
  studioStateCode: string | null | undefined,
  placeOfSupply: string,
): GstTotals {
  const supplyType = supplyTypeFor(studioStateCode, placeOfSupply)
  const results = lines.map((l) => computeLine(l, supplyType))
  const sum = (k: keyof GstLineResult) => results.reduce((s, r) => s + r[k], 0)
  const cgstPaise = sum('cgstPaise')
  const sgstPaise = sum('sgstPaise')
  const igstPaise = sum('igstPaise')
  return {
    supplyType,
    lines: results,
    subtotalPaise: sum('taxablePaise'),
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise: cgstPaise + sgstPaise + igstPaise,
    totalPaise: sum('totalPaise'),
  }
}

/** Indian financial year (April–March) start year for a YYYY-MM-DD date. */
export function financialYearStart(isoDate: string): number {
  const [y, m] = isoDate.split('-').map(Number)
  return m >= 4 ? y : y - 1
}

export function formatInvoiceNumber(fyStart: number, seq: number): string {
  return `INV-${fyStart}-${String(seq).padStart(4, '0')}`
}
