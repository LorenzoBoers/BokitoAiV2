import { appDateLocale } from './app-locale'

export function formatAppNumber(
  value: number,
  language?: string | null,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 1 },
): string {
  return new Intl.NumberFormat(appDateLocale(language), options).format(value)
}

/** Usage ledger costs are USD cents. */
export function formatAppUsdCents(cents: number, language?: string | null): string {
  return new Intl.NumberFormat(appDateLocale(language), {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}
