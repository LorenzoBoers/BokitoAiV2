const GENERIC_VISITOR_NAME =
  /^(website visitor|website bezoeker|websitebezoeker|visitor|bezoeker)$/i

/** Widget/live-chat ids like `cust_ed5ab564` are not emails a person can read. */
export function isOpaqueWidgetAddress(address: string | null | undefined): boolean {
  return /^cust_[a-z0-9]+$/i.test((address ?? '').trim())
}

/** Placeholder widget addresses stored instead of a real inbox. */
export function isPlaceholderContactAddress(address: string | null | undefined): boolean {
  const value = (address ?? '').trim().toLowerCase()
  if (!value) return false
  if (isOpaqueWidgetAddress(value)) return true
  return value === 'visitor@web' || value === 'visitor@widget' || value.startsWith('visitor@')
}

export function isGenericVisitorName(name: string | null | undefined): boolean {
  return GENERIC_VISITOR_NAME.test((name ?? '').trim())
}

/** Prefer a real name; map leftover English widget labels to the local visitor term.
 * When there is no name, derive a readable label from the email local-part
 * (petra.bakker@… → Petra Bakker) instead of showing the full address as title.
 */
export function humanizeContactName(
  name: string | null | undefined,
  address: string | null | undefined,
  visitorLabel: string,
): string {
  const trimmed = (name ?? '').trim()
  if (trimmed && !isGenericVisitorName(trimmed)) return trimmed
  if (isPlaceholderContactAddress(address) || isGenericVisitorName(trimmed)) return visitorLabel
  const fromEmail = nameFromEmailLocalPart(address)
  if (fromEmail) return fromEmail
  return trimmed
}

/** Turn `petra.bakker` / `jan_de_vries` into a short display name. */
export function nameFromEmailLocalPart(address: string | null | undefined): string {
  const email = (address ?? '').trim()
  if (!email.includes('@') || isPlaceholderContactAddress(email)) return ''
  const local = email.split('@')[0] ?? ''
  if (!local || /^[0-9]+$/.test(local)) return ''
  const particles = new Set(['de', 'den', 'der', 'van', 'het', 'ten', 'ter', 'la', 'le'])
  const parts = local
    .replace(/[._+-]+/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return ''
  return parts
    .map((part, index) => {
      const lower = part.toLowerCase()
      if (index > 0 && particles.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}
