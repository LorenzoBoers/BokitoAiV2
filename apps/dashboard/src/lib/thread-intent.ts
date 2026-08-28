/** Detects customer threads that operators typically handle next to bookkeeping. */
const FINANCIAL_RE =
  /\b(invoice|invoicing|factuur|facturatie|offerte|quote|quotation|billing|betalingsherinnering|aanmaning|payment|btw|vat|inkoop|creditnota|credit\s*note)\b/i

const BILLING_TAG_RE = /^(billing|facturatie|invoice|factuur)$/i

export function threadLooksFinancial(
  subject?: string | null,
  preview?: string | null,
): boolean {
  const text = `${subject ?? ''} ${preview ?? ''}`.trim()
  if (!text) return false
  return FINANCIAL_RE.test(text)
}

/** Canonical inbox label for invoice / quote threads. */
export function suggestedBillingTag(tags: string[] | null | undefined): string | null {
  if ((tags ?? []).some((tag) => BILLING_TAG_RE.test(tag))) return null
  return 'billing'
}
