/** Make search-hit titles readable when the index prefixes a path. */
export function humanizeKnowledgeTitle(title: string | null | undefined): string {
  const trimmed = (title ?? '').trim()
  if (!trimmed) return ''
  const parts = trimmed
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  const deduped: string[] = []
  for (const part of parts) {
    if (deduped[deduped.length - 1]?.toLowerCase() !== part.toLowerCase()) {
      deduped.push(part)
    }
  }
  if (deduped.length >= 2 && deduped[1].toLowerCase().startsWith(deduped[0].toLowerCase())) {
    return deduped.slice(1).join(' / ')
  }
  return deduped[deduped.length - 1] ?? trimmed
}
