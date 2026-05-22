/**
 * Customer-safe work log filter for widget embed (Phase 6).
 */
export interface WorkLogEvent {
  type: string
  title?: string
  body?: string
}

const FORBIDDEN = [
  /\.(ts|tsx|js|jsx|mjs|json|md|py|sql|yml|yaml|toml|sh)\b/i,
  /(^|\s)\/[\w./-]+/,
  /\b[a-z][a-zA-Z0-9]+(?:[A-Z][a-zA-Z0-9]*)+\b/,
  /\b[a-z]+_[a-z_]+\b/,
  /\b\d{2,}\s*(?:tokens?|tok|tokens_used|prompt_tokens|completion_tokens)\b/i,
  /\b(claude-|gpt-|sonnet|opus|haiku|gemini|llama)\b/i,
]

export function isCustomerSafeLogEvent(ev: WorkLogEvent): boolean {
  if (ev.type !== 'log') return false
  const title = String(ev.title ?? '')
  if (!title.trim()) return false
  return !FORBIDDEN.some((re) => re.test(title))
}
