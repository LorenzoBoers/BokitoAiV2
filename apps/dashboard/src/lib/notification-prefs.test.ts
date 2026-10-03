import { describe, expect, it } from 'vitest'
import {
  defaultNotificationPrefs,
  normalizeNotificationPrefs,
  setCategoryChannel,
  setTierChannel,
  TIER_ALLOWED,
} from './notification-prefs'

describe('notification prefs', () => {
  it('fills gaps from defaults and drops unknown categories', () => {
    const prefs = normalizeNotificationPrefs({
      tiers: { '1': { push: false } },
      rows: [
        { id: 'unknown', channels: { inapp: true } },
        { id: 'mentions', channels: { email: true } },
      ],
    })
    expect(prefs.tiers['1']).toEqual({ inapp: true, push: false, email: false })
    expect(prefs.rows.find((r) => r.id === 'unknown')).toBeUndefined()
    expect(prefs.rows.find((r) => r.id === 'mentions')?.channels).toEqual({ inapp: true, push: true, email: true })
  })

  it('never offers push below tier 1', () => {
    expect(TIER_ALLOWED['2']).not.toContain('push')
    expect(TIER_ALLOWED['3']).not.toContain('push')
  })

  it('updates one switch without touching the rest', () => {
    const base = defaultNotificationPrefs()
    const next = setCategoryChannel(setTierChannel(base, '3', 'email', true), 'decisions', 'push', false)
    expect(next.tiers['3'].email).toBe(true)
    expect(next.tiers['1']).toEqual(base.tiers['1'])
    expect(next.rows.find((r) => r.id === 'decisions')?.channels.push).toBe(false)
    expect(base.rows.find((r) => r.id === 'decisions')?.channels.push).toBe(true)
  })
})
