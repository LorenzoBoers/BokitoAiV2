const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when a string looks like a UUID rather than a human label. */
export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

/** Prefer a readable label; fall back when value is missing or UUID-shaped. */
export function displayNameOrFallback(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (!trimmed || looksLikeUuid(trimmed)) return fallback
  return trimmed
}

/** Turn snake_case identifiers into readable labels. */
export function humanizeSnakeCase(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  return trimmed
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
