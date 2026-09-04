import { newConversationPath } from './messages-paths'

/** Open New conversation with a message already in the composer. */
export function talkToAssistantPath(prefill: string, agentId?: string | null): string {
  return newConversationPath({
    intent: 'agent',
    agentId: (agentId || '').trim() || undefined,
    prefill: prefill.trim() || undefined,
  })
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
