/** Normalize legacy backend run titles for display. */
export function formatWorkLogSubject(subject: string | null | undefined, fallback: string): string {
  const trimmed = subject?.trim()
  if (!trimmed) return fallback
  return trimmed.replace(/^PO heartbeat\b/i, 'Orchestrator heartbeat')
}
