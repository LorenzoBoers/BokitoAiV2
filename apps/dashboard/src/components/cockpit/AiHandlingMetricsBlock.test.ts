import { describe, expect, it } from 'vitest'
import {
  aiSharePercent,
  relativeChangePct,
  splitComparablePeriods,
} from './AiHandlingMetricsBlock'
import type { ActionMixDay } from '../../lib/bokito-api'

function day(n: number, ai: number, manual = 0): ActionMixDay {
  return {
    date: `2026-01-${String(n).padStart(2, '0')}`,
    ai_minutes: ai,
    manual_minutes: manual,
    ai_count: ai > 0 ? 1 : 0,
    manual_count: manual > 0 ? 1 : 0,
  }
}

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

describe('splitComparablePeriods', () => {
  it('splits a double-length series into equal windows', () => {
    const points = [
      ...Array.from({ length: 7 }, (_, i) => day(i + 1, 10)),
      ...Array.from({ length: 7 }, (_, i) => day(i + 8, 20)),
    ]
    const { current, previous } = splitComparablePeriods(points, 7)
    expect(previous?.aiMinutes).toBe(70)
    expect(current.aiMinutes).toBe(140)
  })

  it('omits previous when the series is shorter than two windows', () => {
    const points = Array.from({ length: 30 }, (_, i) => day(i + 1, 5))
    const { current, previous } = splitComparablePeriods(points, 30)
    expect(previous).toBeNull()
    expect(current.aiMinutes).toBe(150)
  })
})
