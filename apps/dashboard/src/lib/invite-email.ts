/** Lightweight work-email check for invite forms (not RFC-complete). */
export function isLikelyEmail(value: string): boolean {
  const raw = value.trim()
  if (!raw || raw.includes(' ')) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
}
