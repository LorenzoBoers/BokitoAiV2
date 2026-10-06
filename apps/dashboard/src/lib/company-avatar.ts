import { extractDomain } from './domain-favicon'

/**
 * Consumer mail providers never form a company logo in the list — keep in sync
 * with ``app.services.companies.FREE_EMAIL_DOMAINS``.
 */
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.nl',
  'hotmail.co.uk',
  'live.com',
  'live.nl',
  'msn.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'mail.com',
  'zoho.com',
  'hey.com',
  'ziggo.nl',
  'kpnmail.nl',
  'planet.nl',
  'home.nl',
  'xs4all.nl',
  'telenet.be',
  'skynet.be',
  'example.com',
  'example.net',
  'example.org',
  'example.edu',
  'test.com',
  'localhost',
  'invalid',
])

export function isFreeEmailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false
  return FREE_EMAIL_DOMAINS.has(domain.trim().toLowerCase())
}

/** Two+ spaced words → likely a person ("Harold van Bourgondiën"), not "Google". */
export function looksLikePersonalName(name: string | null | undefined): boolean {
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((part) => /[a-zA-ZÀ-ÿ]/.test(part))
  return parts.length >= 2
}

/**
 * Prefer the domain favicon for organisation senders (noreply@moneybird.com,
 * contact named "Google"). People and free-mail addresses keep PersonAvatar.
 */
export function preferCompanyFavicon(
  name: string | null | undefined,
  email: string | null | undefined,
  host?: string | null,
): boolean {
  const domain = (host ?? '').trim().toLowerCase() || extractDomain(email)
  if (!domain || !domain.includes('.') || isFreeEmailDomain(domain)) return false
  if (looksLikePersonalName(name)) return false
  return true
}
