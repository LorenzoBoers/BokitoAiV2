/**
 * Shared labels for platform-owned signal (case) types.
 *
 * The API stores NL/MKB seed names; this catalog keeps EN and NL shells aligned
 * by slug, and leaves operator-customized names alone.
 */

export type SignalTypeLabelSource = {
  slug?: string | null
  name?: string | null
}

type CatalogEntry = {
  en: string
  nl: string
  /** Seed names (any locale) that still count as platform-owned. */
  names: ReadonlySet<string>
}

const PLATFORM_SIGNAL_TYPE_CATALOG: Record<string, CatalogEntry> = {
  invoice_payment: {
    en: 'Invoice / payment',
    nl: 'Factuur/betaling',
    names: new Set(['Factuur/betaling', 'Invoice/payment', 'Invoice / payment']),
  },
  complaint: {
    en: 'Complaint',
    nl: 'Klacht',
    names: new Set(['Complaint', 'Klacht']),
  },
  bug_report: {
    en: 'Bug report',
    nl: 'Storing',
    names: new Set(['Bug report', 'Storing']),
  },
  feature_request: {
    en: 'Feature request',
    nl: 'Functieverzoek',
    names: new Set(['Feature request', 'Functieverzoek']),
  },
  spam_abuse: {
    en: 'Spam or abuse',
    nl: 'Spam of misbruik',
    names: new Set(['Spam or abuse', 'Spam of misbruik']),
  },
  billing_inquiry: {
    en: 'Billing inquiry',
    nl: 'Factuurvraag',
    names: new Set(['Billing inquiry', 'Factuurvraag']),
  },
}

function catalogLocale(language: string | undefined): 'en' | 'nl' {
  return (language || 'en').toLowerCase().startsWith('nl') ? 'nl' : 'en'
}

/** Display label for a signal type in the active UI language. */
export function signalTypeLabel(
  type: SignalTypeLabelSource | null | undefined,
  language?: string,
): string {
  const name = (type?.name ?? '').trim()
  const slug = (type?.slug ?? '').trim().toLowerCase()
  const entry = slug ? PLATFORM_SIGNAL_TYPE_CATALOG[slug] : undefined
  if (entry && (!name || entry.names.has(name))) {
    return entry[catalogLocale(language)]
  }
  return name || slug
}

export function isPlatformSignalTypeSlug(slug: string | null | undefined): boolean {
  return Boolean(slug && PLATFORM_SIGNAL_TYPE_CATALOG[slug.trim().toLowerCase()])
}
