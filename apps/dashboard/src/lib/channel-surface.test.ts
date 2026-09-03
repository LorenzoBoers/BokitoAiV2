import { afterEach, describe, expect, it } from 'vitest'
import {
  isChannelParked,
  normalizeParkedChannels,
  parkedChannels,
  setParkedChannels,
  withoutParkedChannels,
} from './channel-surface'

afterEach(() => {
  setParkedChannels(['slack'])
})

describe('normalizeParkedChannels', () => {
  it('lowercases and trims platform values', () => {
    expect(normalizeParkedChannels([' Slack ', 'WHATSAPP'])).toEqual(['slack', 'whatsapp'])
  })

  it('falls back to the default when the payload has no list', () => {
    expect(normalizeParkedChannels(undefined)).toEqual(['slack'])
    expect(normalizeParkedChannels('slack')).toEqual(['slack'])
  })

  it('accepts an empty list as "nothing parked"', () => {
    expect(normalizeParkedChannels([])).toEqual([])
  })
})

describe('isChannelParked', () => {
  it('parks slack by default so the first render never flashes it', () => {
    expect(parkedChannels()).toEqual(['slack'])
    expect(isChannelParked('slack')).toBe(true)
    expect(isChannelParked('Slack')).toBe(true)
    expect(isChannelParked('email')).toBe(false)
  })

  it('treats an empty channel as not parked', () => {
    expect(isChannelParked('')).toBe(false)
    expect(isChannelParked(null)).toBe(false)
  })

  it('follows the platform list once the session is known', () => {
    setParkedChannels([])
    expect(isChannelParked('slack')).toBe(false)
    setParkedChannels(['whatsapp'])
    expect(isChannelParked('whatsapp')).toBe(true)
    expect(isChannelParked('slack')).toBe(false)
  })
})

describe('withoutParkedChannels', () => {
  it('drops parked keys and preserves order', () => {
    expect(withoutParkedChannels(['email', 'whatsapp', 'widget', 'slack'])).toEqual([
      'email',
      'whatsapp',
      'widget',
    ])
  })

  it('returns everything when nothing is parked', () => {
    setParkedChannels([])
    expect(withoutParkedChannels(['email', 'slack'])).toEqual(['email', 'slack'])
  })
})
