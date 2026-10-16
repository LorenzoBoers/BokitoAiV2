import { describe, expect, it } from 'vitest'
import {
  composerModeForFocus,
  emptyClientFocus,
  ensureFocusMentionsInBody,
  focusFromMentionBody,
  focusFromTargets,
  focusLabelName,
  singleAgentFocus,
  syncAgentMentionsInBody,
} from './composer-reply-focus'

describe('composer-reply-focus', () => {
  it('builds agent focus from targets', () => {
    const focus = focusFromTargets([
      { type: 'agent', id: 'a1', name: 'Alpha' },
      { type: 'agent', id: 'a2', name: 'Beta' },
    ])
    expect(focus.kind).toBe('agents')
    expect(focus.primaryAgentId).toBe('a1')
    expect(focusLabelName(focus, 'AI')).toBe('Alpha +1')
  })

  it('builds mixed focus', () => {
    const focus = focusFromTargets([
      { type: 'agent', id: 'a1', name: 'Alpha' },
      { type: 'user', id: 'u1', name: 'Sam' },
    ])
    expect(focus.kind).toBe('mixed')
    expect(composerModeForFocus(focus)).toBe('ask')
  })

  it('builds humans-only focus on the teammate message tab', () => {
    const focus = focusFromTargets([{ type: 'user', id: 'u1', name: 'Sam' }])
    expect(focus.kind).toBe('humans')
    // Still uses the note mode slot in the composer; send posts as_chat.
    expect(composerModeForFocus(focus)).toBe('note')
  })

  it('parses mention body', () => {
    const focus = focusFromMentionBody(
      'Hi @[Alpha](agent:11111111-1111-1111-1111-111111111111) @[Sam](user:42)',
    )
    expect(focus.kind).toBe('mixed')
    expect(focus.targets).toHaveLength(2)
  })

  it('ensures mention chips', () => {
    const focus = singleAgentFocus({ id: 'a1', name: 'Alpha' })
    const next = ensureFocusMentionsInBody('hello', focus)
    expect(next.startsWith('@[Alpha](agent:a1)')).toBe(true)
    expect(ensureFocusMentionsInBody(next, focus)).toBe(next)
  })

  it('sync replaces other agent chips', () => {
    const focus = singleAgentFocus({ id: 'b1', name: 'Bokito' })
    const raw = '@[Orchestrator](agent:a1) please help'
    const next = syncAgentMentionsInBody(raw, focus)
    expect(next).toContain('@[Bokito](agent:b1)')
    expect(next).not.toContain('Orchestrator')
  })

  it('client focus is empty', () => {
    expect(emptyClientFocus().kind).toBe('client')
    expect(composerModeForFocus(emptyClientFocus())).toBe('reply')
  })
})
