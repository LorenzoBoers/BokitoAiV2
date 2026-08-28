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

/** Quote text for the last inbound message, including HTML-only mail. */
export function inboundQuoteText(message: {
  bodyText?: string | null
  bodyPreview?: string | null
  bodyHtml?: string | null
}): string {
  const text = message.bodyText?.trim()
  if (text) return text
  const preview = message.bodyPreview?.trim()
  if (preview) return preview
  const html = message.bodyHtml?.trim()
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function parseAddressList(value?: string | null): string[] {
  if (!value?.trim()) return []
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean)
      }
    } catch {
      // Fall through to comma-separated parsing.
    }
  }
  return trimmed.split(/[,;]/).map((part) => part.trim()).filter(Boolean)
}

/** CC seed for Reply all: inbound CC plus other To recipients, minus us. */
export function suggestedReplyAllRecipients(input: {
  cc?: string | null
  toAddresses?: string | null
  exclude: string[]
}): string | null {
  const excluded = new Set(input.exclude.map((addr) => addr.trim().toLowerCase()).filter(Boolean))
  const unique: string[] = []
  const seen = new Set<string>()
  for (const addr of [...parseAddressList(input.cc), ...parseAddressList(input.toAddresses)]) {
    const key = addr.toLowerCase()
    if (!key || excluded.has(key) || seen.has(key)) continue
    seen.add(key)
    unique.push(addr)
  }
  return unique.length ? unique.join(', ') : null
}
