/**
 * Durable hand-off from "New conversation" into ThreadDetail.
 *
 * Navigation `state` alone is unreliable: Communication remounts and
 * `navigate(..., { replace: true })` / `setSearchParams` can wipe it before
 * the auto-send effect runs, leaving an empty "Untitled chat". The opener is
 * also stored on the server at create time; this flag only tells the thread
 * page to kick the agent (`continue_pending`) or to re-send a lost draft.
 */

const PREFIX = 'bokito:chat-continue:'

export type ChatContinuePayload =
  | { mode: 'continue' }
  | { mode: 'send'; text: string; attachments?: unknown[] }

function key(threadId: string): string {
  return `${PREFIX}${threadId}`
}

export function stashChatContinue(threadId: string, payload: ChatContinuePayload): void {
  if (!threadId) return
  try {
    sessionStorage.setItem(key(threadId), JSON.stringify(payload))
  } catch {
    // Private mode / quota — navigation state is the only fallback.
  }
}

export function takeChatContinue(threadId: string): ChatContinuePayload | null {
  if (!threadId) return null
  try {
    const raw = sessionStorage.getItem(key(threadId))
    if (!raw) return null
    sessionStorage.removeItem(key(threadId))
    const parsed = JSON.parse(raw) as ChatContinuePayload
    if (parsed?.mode === 'continue') return parsed
    if (parsed?.mode === 'send' && typeof parsed.text === 'string') {
      const text = parsed.text.trim()
      const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : undefined
      if (!text && !attachments?.length) return null
      return { mode: 'send', text, attachments }
    }
  } catch {
    try {
      sessionStorage.removeItem(key(threadId))
    } catch {
      // ignore
    }
  }
  return null
}

export function peekChatContinue(threadId: string): boolean {
  if (!threadId) return false
  try {
    return sessionStorage.getItem(key(threadId)) != null
  } catch {
    return false
  }
}
