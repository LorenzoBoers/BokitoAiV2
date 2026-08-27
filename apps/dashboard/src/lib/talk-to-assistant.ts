import { newConversationPath } from './messages-paths'

export type TalkToAssistantOpts = {
  kind?: 'company' | 'personal'
}

/** Open New conversation with a message already in the composer. */
export function talkToAssistantPath(prefill: string, opts?: TalkToAssistantOpts): string {
  const path = newConversationPath()
  const parts: string[] = []
  const text = prefill.trim()
  if (text) parts.push(`prefill=${encodeURIComponent(text)}`)
  if (opts?.kind) parts.push(`kind=${encodeURIComponent(opts.kind)}`)
  return parts.length ? `${path}?${parts.join('&')}` : path
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
