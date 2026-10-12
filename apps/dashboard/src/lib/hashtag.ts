/** Strip a typed leading `#` so inputs can show the mark as a fixed prefix. */
export function stripHash(value: string): string {
  return value.replace(/^\s*#+/, '')
}

/** Same shape the API stores: no `#`, lowercase, words joined by `_`. */
export function normalizeHashtag(value: string): string {
  return stripHash(value)
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
}
