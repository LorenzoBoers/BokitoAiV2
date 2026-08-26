/** Compact excerpt for the "no reply needed" card — not a second copy of the email. */

const DEFAULT_MAX = 160

export function formatDecisionExcerpt(text: string, maxChars: number = DEFAULT_MAX): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  if (cleaned.length > maxChars) {
    const slice = cleaned.slice(0, maxChars)
    const at = slice.lastIndexOf(' ')
    const clipped = (at >= 40 ? slice.slice(0, at) : slice).replace(/[.,;:]+$/, '').trimEnd()
    return clipped ? `${clipped}...` : `${slice.trimEnd()}...`
  }
  if (looksHardCut(cleaned)) return `${cleaned}...`
  return cleaned
}

function looksHardCut(text: string): boolean {
  if (/[.!?…]$/.test(text)) return false
  const last = text.split(/\s+/).pop() ?? ''
  if (last.length > 0 && last.length <= 4 && /^[\p{L}]+$/u.test(last)) return true
  return text.length === 200 || text.length === 280
}
