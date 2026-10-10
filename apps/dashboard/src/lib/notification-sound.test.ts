import { describe, expect, it, beforeEach } from 'vitest'
import {
  isNotificationSoundEnabled,
  playIncomingNotificationSound,
  setNotificationSoundEnabled,
  unlockNotificationAudio,
} from './notification-sound'

describe('notification-sound', () => {
  beforeEach(() => {
    setNotificationSoundEnabled(true)
  })

  it('playIncomingNotificationSound is safe without a browser window', async () => {
    await expect(playIncomingNotificationSound()).resolves.toBeUndefined()
  })

  it('unlockNotificationAudio is safe without a browser window', () => {
    expect(() => unlockNotificationAudio()).not.toThrow()
  })

  it('respects the sound preference when set off', async () => {
    setNotificationSoundEnabled(false)
    expect(isNotificationSoundEnabled()).toBe(false)
    await expect(playIncomingNotificationSound()).resolves.toBeUndefined()
    setNotificationSoundEnabled(true)
    expect(isNotificationSoundEnabled()).toBe(true)
  })
})
