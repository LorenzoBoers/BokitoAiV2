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

/** Prefer a real name; map leftover English widget labels to the local visitor term. */
export function humanizeContactName(
  name: string | null | undefined,
  address: string | null | undefined,
  visitorLabel: string,
): string {
  const trimmed = (name ?? '').trim()
  if (trimmed && !isGenericVisitorName(trimmed)) return trimmed
  if (isPlaceholderContactAddress(address) || isGenericVisitorName(trimmed)) return visitorLabel
  return trimmed
}
