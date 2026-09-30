import { describe, expect, it } from 'vitest'

/** Pure state derivation mirrored from AiStatusChip — keeps the chip label contract tested without mounting Radix. */
function deriveAiStatusState(
  aiMode: 'suggest' | 'auto' | 'off' | null,
  aiPaused: boolean,
): 'paused' | 'auto' | 'suggest' | 'off' {
  if (aiPaused) return 'paused'
  if (aiMode === 'auto') return 'auto'
  if (aiMode === 'off') return 'off'
  return 'suggest'
}

describe('AiStatusChip state', () => {
  it('treats aiPaused as takeover regardless of channel mode', () => {
    expect(deriveAiStatusState('auto', true)).toBe('paused')
    expect(deriveAiStatusState('suggest', true)).toBe('paused')
    expect(deriveAiStatusState('off', true)).toBe('paused')
  })

  it('maps channel modes when not paused', () => {
    expect(deriveAiStatusState('suggest', false)).toBe('suggest')
    expect(deriveAiStatusState('auto', false)).toBe('auto')
    expect(deriveAiStatusState('off', false)).toBe('off')
    expect(deriveAiStatusState(null, false)).toBe('suggest')
  })
})
