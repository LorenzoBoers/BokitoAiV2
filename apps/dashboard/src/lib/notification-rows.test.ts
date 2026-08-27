import { describe, expect, it } from 'vitest'
import {
  canonicalizeNotificationRows,
  desktopEnabledCount,
  pauseAllDesktop,
  restoreDefaultNotificationRows,
} from './notification-rows'

describe('notification rows', () => {
  it('drops unknown categories and fills missing channels', () => {
    const next = canonicalizeNotificationRows([
      { id: 'unknown', label: 'x', channels: { desktop: true } },
      { id: 'mentions', label: 'ignored', channels: { email: true } },
    ])
    expect(next).toHaveLength(1)
    expect(next[0]?.id).toBe('mentions')
    expect(next[0]?.channels.desktop).toBe(true)
    expect(next[0]?.channels.email).toBe(true)
  })

  it('pauses every in-app toggle', () => {
    const paused = pauseAllDesktop(restoreDefaultNotificationRows())
    expect(desktopEnabledCount(paused)).toBe(0)
    expect(paused.find((row) => row.id === 'digest-daily')?.channels.desktop).toBeUndefined()
  })
})
