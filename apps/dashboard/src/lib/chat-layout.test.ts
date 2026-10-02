import { describe, expect, it } from 'vitest'

import { assignBubbleStacks, CHAT_STACK_GAP_MS } from './chat-layout'

const minute = 60_000

function row(id: string, key: string | null, minutes: number, breaksRun = false) {
  return { id, key, timeMs: minutes * minute, breaksRun }
}

describe('assignBubbleStacks', () => {
  it('groups consecutive messages from the same author', () => {
    const stacks = assignBubbleStacks([
      row('a', 'agent:1', 0),
      row('b', 'agent:1', 1),
      row('c', 'agent:1', 2),
      row('d', 'user:7', 3),
    ])
    expect([...stacks.values()]).toEqual(['start', 'middle', 'end', 'single'])
  })

  it('starts a new run after the stack gap', () => {
    const stacks = assignBubbleStacks([
      row('a', 'agent:1', 0),
      row('b', 'agent:1', CHAT_STACK_GAP_MS / minute + 1),
    ])
    expect(stacks.get('a')).toBe('single')
    expect(stacks.get('b')).toBe('single')
  })

  it('breaks a run on a non-message row and on a missing key', () => {
    const stacks = assignBubbleStacks([
      row('a', 'agent:1', 0),
      row('day', null, 0, true),
      row('b', 'agent:1', 1),
      row('decision', null, 2),
      row('c', 'agent:1', 3),
    ])
    expect(stacks.get('a')).toBe('single')
    expect(stacks.get('b')).toBe('single')
    expect(stacks.get('decision')).toBe('single')
    expect(stacks.get('c')).toBe('single')
  })
})
