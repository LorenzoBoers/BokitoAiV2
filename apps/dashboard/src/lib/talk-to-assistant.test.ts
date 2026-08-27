import { describe, expect, it } from 'vitest'
import {
  enabledAutomationCount,
  platformCheckInTrigger,
  talkToAssistantPath,
} from './talk-to-assistant'

describe('talkToAssistantPath', () => {
  it('adds a prefill query', () => {
    expect(talkToAssistantPath('Turn on the check-in')).toBe(
      '/communication/new?prefill=Turn%20on%20the%20check-in',
    )
  })

  it('returns the bare path when empty', () => {
    expect(talkToAssistantPath('  ')).toBe('/communication/new')
  })

  it('targets the company assistant when requested', () => {
    expect(talkToAssistantPath('Help me set up', { kind: 'company' })).toBe(
      '/communication/new?prefill=Help%20me%20set%20up&kind=company',
    )
  })
})

describe('enabledAutomationCount', () => {
  it('ignores seeded-but-paused triggers', () => {
    expect(
      enabledAutomationCount([
        { enabled: false, kind: 'heartbeat' },
        { enabled: true, kind: 'interval' },
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
