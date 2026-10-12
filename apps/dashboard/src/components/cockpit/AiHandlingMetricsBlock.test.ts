import { describe, expect, it } from 'vitest'
import { aiSharePercent, relativeChangePct } from './AiHandlingMetricsBlock'

describe('aiSharePercent', () => {
  it('uses action counts when present', () => {
    expect(
      aiSharePercent({ aiMinutes: 10, manualMinutes: 90, aiCount: 3, manualCount: 1 }),
    ).toBe(75)
  })

  it('falls back to minutes when counts are empty', () => {
    expect(
      aiSharePercent({ aiMinutes: 30, manualMinutes: 10, aiCount: 0, manualCount: 0 }),
    ).toBe(75)
  })
})

describe('relativeChangePct', () => {
  it('returns the percent change against a previous baseline', () => {
    expect(relativeChangePct(33, 22)).toBeCloseTo(50)
    expect(relativeChangePct(10, 20)).toBeCloseTo(-50)
  })

  it('treats new activity against an empty baseline as +100', () => {
    expect(relativeChangePct(12, 0)).toBe(100)
    expect(relativeChangePct(0, 0)).toBeNull()
  })
})
