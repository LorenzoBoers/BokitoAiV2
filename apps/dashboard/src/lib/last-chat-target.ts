export const LAST_CHAT_TARGET_KEY = 'bokito.lastChatTarget'

export function readLastChatTarget(): string {
  try {
    return (globalThis.localStorage.getItem(LAST_CHAT_TARGET_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

export function writeLastChatTarget(id: string): void {
  const next = id.trim()
  try {
    if (!next) globalThis.localStorage.removeItem(LAST_CHAT_TARGET_KEY)
    else globalThis.localStorage.setItem(LAST_CHAT_TARGET_KEY, next)
  } catch {
    // Private mode — picker still works.
  }
}
