// Deterministic avatar utilities — initials + color seeded by email

const PALETTE: Array<{ bg: string; text: string }> = [
  { bg: '#4652f2', text: '#ffffff' },
  { bg: '#7c3aed', text: '#ffffff' },
  { bg: '#0891b2', text: '#ffffff' },
  { bg: '#0d9488', text: '#ffffff' },
  { bg: '#059669', text: '#ffffff' },
  { bg: '#d97706', text: '#ffffff' },
  { bg: '#dc2626', text: '#ffffff' },
  { bg: '#db2777', text: '#ffffff' },
  { bg: '#9333ea', text: '#ffffff' },
  { bg: '#2563eb', text: '#ffffff' },
  { bg: '#16a34a', text: '#ffffff' },
  { bg: '#ea580c', text: '#ffffff' },
]

/** First initial of first word + first initial of last word, uppercase. */
export function getInitials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) {
    const word = parts[0]
    return (word.slice(0, 2)).toUpperCase()
  }
  const first = parts[0][0] ?? ''
  const last = parts[parts.length - 1][0] ?? ''
  return (first + last).toUpperCase()
}

/**
 * Initials from the local part of an email address: "john.doe@x.com" → "JD".
 * Separator characters (., _, -, +) split words; falls back to the first two
 * characters of the local part. Returns '' when there is no usable local part.
 */
export function getEmailInitials(email: string | null | undefined): string {
  const address = (email ?? '').trim()
  const atIndex = address.indexOf('@')
  const local = (atIndex >= 0 ? address.slice(0, atIndex) : address).trim()
  if (!local) return ''
  const parts = local.split(/[._\-+]+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

/** Deterministic color from email string. */
export function getAvatarColor(seed: string): { bg: string; text: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
