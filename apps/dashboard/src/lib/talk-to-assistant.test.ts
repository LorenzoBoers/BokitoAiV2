import { describe, expect, it } from 'vitest'
import {
  enabledAutomationCount,
  platformCheckInTrigger,
  talkToAssistantPath,
} from './talk-to-assistant'

describe('talkToAssistantPath', () => {
  it('adds a prefill query', () => {
    expect(talkToAssistantPath('Turn on the check-in')).toBe(
      '/communication/new?prefill=Turn+on+the+check-in',
    )
  })

  it('adds agent and prefill', () => {
    expect(talkToAssistantPath('Help set up Accounting', 'agent-1')).toBe(
      '/communication/new?prefill=Help+set+up+Accounting&agent=agent-1',
    )
  })

  it('returns the bare path when empty', () => {
    expect(talkToAssistantPath('  ')).toBe('/communication/new')
  })
})

describe('enabledAutomationCount', () => {
  it('ignores seeded-but-paused triggers', () => {
    expect(
      enabledAutomationCount([
        { enabled: false },
        { enabled: true },
      ]),
    ).toBe(1)
  })
})

describe('platformCheckInTrigger', () => {
  it('picks the heartbeat row', () => {
    const row = platformCheckInTrigger([
      { kind: 'interval', id: 'a' },
      { kind: 'heartbeat', id: 'b' },
    ])
    expect(row?.id).toBe('b')
  })
})
