/** Strip a typed leading `#` so inputs can show the mark as a fixed prefix. */
export function stripHash(value: string): string {
  return value.replace(/^\s*#+/, '')
}

/** Same shape the API stores: no `#`, lowercase, words joined by `-`. */
export function normalizeHashtag(value: string): string {
  return stripHash(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}
