import { describe, expect, it } from 'vitest'
import { messageHeldForReveal } from './thread-reveal'

describe('messageHeldForReveal', () => {
  const now = Date.parse('2026-10-19T10:17:55.000Z')

  it('holds a bubble whose reveal time is still ahead', () => {
    expect(messageHeldForReveal('2026-10-19T10:17:55.450Z', now, false)).toBe(true)
  })

  it('shows a bubble once its reveal time has passed', () => {
    expect(messageHeldForReveal('2026-10-19T10:17:54.000Z', now, false)).toBe(false)
  })

  it('shows immediately when motion is reduced or the stamp is missing', () => {
    expect(messageHeldForReveal('2026-10-19T10:17:55.450Z', now, true)).toBe(false)
    expect(messageHeldForReveal(null, now, false)).toBe(false)
  })
})
