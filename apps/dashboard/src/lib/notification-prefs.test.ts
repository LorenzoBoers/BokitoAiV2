import { describe, expect, it } from 'vitest'
import {
  categoryCellsOn,
  defaultNotificationPrefs,
  normalizeNotificationPrefs,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SECTIONS,
  setCategoryCells,
  setCategoryChannel,
  setTierCells,
  setTierChannel,
  TIER_ALLOWED,
  tierCellsOn,
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

  it('a section master sets every allowed cell and leaves other sections', () => {
    const base = defaultNotificationPrefs()
    const conversations = NOTIFICATION_SECTIONS.find((section) => section.id === 'conversations')!.rows
    const next = setCategoryCells(base, conversations, NOTIFICATION_CHANNELS, true)
    expect(categoryCellsOn(next, conversations, NOTIFICATION_CHANNELS)).toBe(true)
    expect(next.rows.find((r) => r.id === 'new-message')?.channels).toEqual({
      inapp: true,
      push: true,
      email: true,
    })
    expect(next.rows.find((r) => r.id === 'ops-run-failed')?.channels).toEqual(
      base.rows.find((r) => r.id === 'ops-run-failed')?.channels,
    )
    expect(next.rows.find((r) => r.id === 'digest-weekly')?.channels.push).toBe(false)
  })

  it('a row master ignores channels that row cannot use', () => {
    const next = setCategoryCells(defaultNotificationPrefs(), ['digest-weekly'], NOTIFICATION_CHANNELS, true)
    expect(next.rows.find((r) => r.id === 'digest-weekly')?.channels).toEqual({
      inapp: false,
      push: false,
      email: true,
    })
    expect(categoryCellsOn(next, ['digest-weekly'], NOTIFICATION_CHANNELS)).toBe(true)
  })

  it('a tier master sets every allowed channel on those tiers', () => {
    const base = defaultNotificationPrefs()
    expect(tierCellsOn(base, ['1', '2', '3'], NOTIFICATION_CHANNELS)).toBe(false)
    const next = setTierCells(base, ['2'], NOTIFICATION_CHANNELS, true)
    expect(next.tiers['2']).toEqual({ inapp: true, push: false, email: true })
    expect(tierCellsOn(next, ['2'], NOTIFICATION_CHANNELS)).toBe(true)
    expect(next.tiers['1']).toEqual(base.tiers['1'])
  })
})
