/**
 * Derive a public domain favicon URL for a given email address.
 *
 * Uses Google S2 favicons service which works for the vast majority of
 * sender domains. Caller is expected to handle <img onError> fallback to
 * an initials avatar when the favicon cannot be loaded.
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

export function getDomainFaviconUrl(email: string | null | undefined, size = 64): string | null {
  const domain = extractDomain(email)
  if (!domain) return null
  return `${FAVICON_SERVICE}?sz=${size}&domain=${encodeURIComponent(domain)}`
}
