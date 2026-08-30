import { newConversationPath } from './messages-paths'

/** Open New conversation with a message already in the composer. */
export function talkToAssistantPath(prefill: string, agentId?: string | null): string {
  const path = newConversationPath()
  const params = new URLSearchParams()
  const text = prefill.trim()
  if (text) params.set('prefill', text)
  const agent = (agentId || '').trim()
  if (agent) params.set('agent', agent)
  const q = params.toString()
  return q ? `${path}?${q}` : path
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
