import { newConversationPath } from './messages-paths'

/** Open New conversation with a message already in the composer. */
export function talkToAssistantPath(prefill: string): string {
  const path = newConversationPath()
  const text = prefill.trim()
  if (!text) return path
  return `${path}?prefill=${encodeURIComponent(text)}`
}

export function isEnabledTrigger(row: { enabled?: boolean }): boolean {
  return row.enabled === true
}

export function enabledAutomationCount(rows: Array<{ enabled?: boolean }>): number {
  return rows.filter(isEnabledTrigger).length
}

export function platformCheckInTrigger<T extends { kind: string }>(
  rows: T[],
): T | undefined {
  return rows.find((row) => row.kind === 'heartbeat')
}
