/**
 * Who the composer is addressing: client (reply), agent(s), teammate(s), or mixed.
 * Drives Ask/Note chrome, facepile marks, and send path.
 */

import type { AvatarStackMember } from '../components/ui/AvatarStack'
import type { AgentAvatarSource } from './agent-avatar'
import { MENTION_MARKUP_PATTERN, mentionMarkup, type MentionItem } from './mentions'

export type ComposerFocusKind = 'client' | 'agents' | 'humans' | 'mixed'

export type ComposerFocusTarget = {
  type: 'agent' | 'user'
  id: string
  name: string
  agent?: AgentAvatarSource
  avatarUrl?: string | null
  email?: string
}

export type ComposerReplyFocus = {
  kind: ComposerFocusKind
  /** Ordered unique targets (agents and/or users). Empty for client. */
  targets: ComposerFocusTarget[]
  /** Primary agent id for Ask send / live seat (first agent in targets). */
  primaryAgentId: string | null
}

export function emptyClientFocus(): ComposerReplyFocus {
  return { kind: 'client', targets: [], primaryAgentId: null }
}

export function focusFromTargets(targets: ComposerFocusTarget[]): ComposerReplyFocus {
  const unique: ComposerFocusTarget[] = []
  const seen = new Set<string>()
  for (const t of targets) {
    const key = `${t.type}:${t.id}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(t)
  }
  const agents = unique.filter((t) => t.type === 'agent')
  const humans = unique.filter((t) => t.type === 'user')
  if (agents.length === 0 && humans.length === 0) return emptyClientFocus()
  if (agents.length > 0 && humans.length > 0) {
    return { kind: 'mixed', targets: unique, primaryAgentId: agents[0].id }
  }
  if (agents.length > 0) {
    return { kind: 'agents', targets: unique, primaryAgentId: agents[0].id }
  }
  return { kind: 'humans', targets: unique, primaryAgentId: null }
}

/** Parse agent/user mention chips from raw composer body (teams expand server-side). */
export function focusFromMentionBody(
  raw: string,
  resolve?: (type: 'agent' | 'user', id: string, name: string) => ComposerFocusTarget | null,
): ComposerReplyFocus {
  const targets: ComposerFocusTarget[] = []
  const pattern = new RegExp(MENTION_MARKUP_PATTERN.source, 'g')
  for (const match of raw.matchAll(pattern)) {
    const name = match[1]
    const type = match[2] as 'user' | 'agent' | 'team'
    const id = match[3]
    if (type === 'team') continue
    if (type !== 'agent' && type !== 'user') continue
    const resolved = resolve?.(type, id, name)
    targets.push(resolved ?? { type, id, name })
  }
  return focusFromTargets(targets)
}

export function singleAgentFocus(
  agent: AgentAvatarSource & { id: string; name: string },
): ComposerReplyFocus {
  return focusFromTargets([
    {
      type: 'agent',
      id: agent.id,
      name: agent.name,
      agent,
    },
  ])
}

/** Ensure each focus target has a mention chip at the start of the body. */
export function ensureFocusMentionsInBody(raw: string, focus: ComposerReplyFocus): string {
  if (focus.kind === 'client' || focus.targets.length === 0) return raw
  let next = raw
  for (const target of [...focus.targets].reverse()) {
    const item: MentionItem = {
      type: target.type,
      id: target.id,
      name: target.name,
    }
    const markup = mentionMarkup(item)
    const pattern = new RegExp(
      `@\\[${escapeRegExp(target.name)}\\]\\(${target.type}:${escapeRegExp(target.id)}\\)`,
    )
    if (pattern.test(next)) continue
    next = `${markup} ${next}`.trimStart()
  }
  return next
}

/** Replace other agent mentions with the focused agent set (keep non-agent text). */
export function syncAgentMentionsInBody(raw: string, focus: ComposerReplyFocus): string {
  if (focus.kind === 'client') return raw
  const withoutAgents = raw.replace(
    new RegExp(MENTION_MARKUP_PATTERN.source, 'g'),
    (full, _name, type) => (type === 'agent' ? '' : full),
  )
  const cleaned = withoutAgents.replace(/[ \t]{2,}/g, ' ').trim()
  return ensureFocusMentionsInBody(cleaned, focus)
}

/** Replace agent and user mention chips with the current focus set. */
export function syncFocusMentionsInBody(raw: string, focus: ComposerReplyFocus): string {
  if (focus.kind === 'client') return raw
  const without = raw.replace(
    new RegExp(MENTION_MARKUP_PATTERN.source, 'g'),
    (full, _name, type) => (type === 'agent' || type === 'user' ? '' : full),
  )
  const cleaned = without.replace(/[ \t]{2,}/g, ' ').trim()
  return ensureFocusMentionsInBody(cleaned, focus)
}

export function focusLabelName(focus: ComposerReplyFocus, fallback: string): string {
  if (focus.targets.length === 0) return fallback
  if (focus.targets.length === 1) return focus.targets[0].name
  const first = focus.targets[0].name
  return `${first} +${focus.targets.length - 1}`
}

export function focusToAvatarStack(
  focus: ComposerReplyFocus,
): AvatarStackMember[] {
  return focus.targets.map((t) => {
    if (t.type === 'agent') {
      const agent = t.agent ?? { id: t.id, name: t.name }
      return {
        key: `agent:${t.id}`,
        kind: 'agent' as const,
        name: t.name,
        id: t.id,
        agent,
      }
    }
    return {
      key: `user:${t.id}`,
      kind: 'user' as const,
      name: t.name,
      email: t.email || '',
      avatarUrl: t.avatarUrl,
    }
  })
}

/** Mode implied by focus when mentions drive the tab. */
export function composerModeForFocus(focus: ComposerReplyFocus): 'ask' | 'note' | 'reply' {
  if (focus.kind === 'client') return 'reply'
  if (focus.kind === 'humans') return 'note'
  return 'ask'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
