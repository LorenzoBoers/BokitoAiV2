/**
 * Composer chrome that follows from what is on screen: which tab opens, and
 * who the "Aan X" label names. Who answers is decided on the server.
 */

import { MENTION_MARKUP_PATTERN } from './mentions'

export type MentionRef = { type: 'user' | 'agent' | 'team'; id: string; name: string }

/** Unique @chips in a raw composer body, in order. */
export function mentionedTargets(raw: string): MentionRef[] {
  const targets: MentionRef[] = []
  const seen = new Set<string>()
  for (const match of raw.matchAll(new RegExp(MENTION_MARKUP_PATTERN.source, 'g'))) {
    const type = match[2]
    if (type !== 'user' && type !== 'agent' && type !== 'team') continue
    const key = `${type}:${match[3]}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ type, id: match[3], name: match[1] })
  }
  return targets
}

/** Unique names of the @chips in a raw composer body, in order. */
export function mentionedNames(raw: string): string[] {
  return mentionedTargets(raw).map((target) => target.name)
}

/** "X", "X, Y" or "X, Y +2" for the Team button. */
export function teamLabelNames(names: string[], max = 2): string {
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} +${names.length - max}`
}

export type ComposerLandMessage = {
  kind?: string | null
  direction?: string | null
  authorUserId?: number | string | null
  payload?: { agent_id?: unknown } | null
}

/**
 * Tab to open from the last message the operator received.
 * Own lines and internal notes are skipped. Note is never chosen here.
 */
export function composerLanding(
  messages: ComposerLandMessage[],
  opts: { selfUserId?: number | string | null; allowReply: boolean },
): 'reply' | 'ask' {
  const self = opts.selfUserId == null ? null : String(opts.selfUserId)
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message) continue
    if (message.kind === 'system_event' || message.kind === 'internal_note') continue
    const agentId = message.payload?.agent_id
    if (message.kind === 'agent_message' || (typeof agentId === 'string' && agentId)) return 'ask'
    if (message.authorUserId != null) {
      if (self != null && String(message.authorUserId) === self) continue
      return 'ask'
    }
    if (message.direction === 'inbound' && opts.allowReply) return 'reply'
  }
  return opts.allowReply ? 'reply' : 'ask'
}
