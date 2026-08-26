/**
 * Derive a public favicon URL for an email domain or host.
 *
 * Uses Google S2 favicons, which works for the vast majority of sender
 * domains. Caller is expected to handle <img onError> fallback to an
 * initials avatar when the favicon cannot be loaded.
 */

const FAVICON_SERVICE = 'https://www.google.com/s2/favicons'

export function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const atIndex = email.indexOf('@')
  if (atIndex < 0 || atIndex === email.length - 1) return null
  const host = email.slice(atIndex + 1).trim().toLowerCase()
  if (!host || host.includes(' ')) return null
  return host
}

export function normalizeFaviconHost(host: string | null | undefined): string | null {
  if (!host) return null
  const cleaned = host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    ?.replace(/:\d+$/, '')
    .replace(/\.$/, '')
  if (!cleaned || cleaned.includes(' ') || cleaned.includes('@')) return null
  return cleaned
}

export function getHostFaviconUrl(host: string | null | undefined, size = 64): string | null {
  const domain = normalizeFaviconHost(host)
  if (!domain) return null
  return `${FAVICON_SERVICE}?sz=${size}&domain=${encodeURIComponent(domain)}`
}

export function getDomainFaviconUrl(email: string | null | undefined, size = 64): string | null {
  return getHostFaviconUrl(extractDomain(email), size)
}
