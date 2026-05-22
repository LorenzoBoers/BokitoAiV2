/**
 * Customer-safe work log filter and DOM helpers for widget embed (Phase 6).
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

export function createWorkLogStackElement(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'bk-worklog-stack'
  const title = document.createElement('div')
  title.className = 'bk-worklog-title'
  title.textContent = 'Working on it...'
  const list = document.createElement('ul')
  list.className = 'bk-worklog-list'
  el.appendChild(title)
  el.appendChild(list)
  return el
}

export function appendWorkLogEvent(stackEl: HTMLElement, ev: WorkLogEvent): void {
  const list = stackEl.querySelector('.bk-worklog-list')
  if (!list) return
  const li = document.createElement('li')
  li.textContent = String(ev.title ?? '')
  list.appendChild(li)
}

export function collapseWorkLogStack(stackEl: HTMLElement): void {
  stackEl.classList.add('bk-worklog-stack--done')
  const title = stackEl.querySelector('.bk-worklog-title')
  if (title) title.textContent = 'Done'
  const list = stackEl.querySelector('.bk-worklog-list')
  if (list instanceof HTMLElement) list.style.display = 'none'
}

export function parseWorkLogRealtimePayload(data: unknown): WorkLogEvent | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  const obj = (row.object && typeof row.object === 'object' ? row.object : row) as Record<
    string,
    unknown
  >
  const eventType = String(row.event_type ?? obj.event_type ?? obj.type ?? '')
  if (eventType === 'work_log_event' || eventType === 'event') {
    const payload = (obj.payload ?? obj.event ?? obj) as Record<string, unknown>
    return {
      type: String(payload.type ?? payload.event_type ?? 'log'),
      title: typeof payload.title === 'string' ? payload.title : undefined,
      body: typeof payload.body === 'string' ? payload.body : undefined,
    }
  }
  if (obj.type) {
    return {
      type: String(obj.type),
      title: typeof obj.title === 'string' ? obj.title : undefined,
      body: typeof obj.body === 'string' ? obj.body : undefined,
    }
  }
  return null
}
