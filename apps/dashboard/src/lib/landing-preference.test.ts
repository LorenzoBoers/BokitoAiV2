import { describe, expect, it } from 'vitest'
import { parseDefaultLanding, pathForDefaultLanding } from './landing-preference'

describe('parseDefaultLanding', () => {
  it('defaults to new conversation', () => {
    expect(parseDefaultLanding(undefined)).toBe('new')
    expect(parseDefaultLanding(null)).toBe('new')
    expect(parseDefaultLanding('')).toBe('new')
    expect(parseDefaultLanding('nope')).toBe('new')
  })

  it('accepts the four start pages', () => {
    expect(parseDefaultLanding('new')).toBe('new')
    expect(parseDefaultLanding('inbox')).toBe('inbox')
    expect(parseDefaultLanding('agenda')).toBe('agenda')
    expect(parseDefaultLanding('today')).toBe('today')
  })

  it('maps legacy values', () => {
    expect(parseDefaultLanding('chat')).toBe('new')
    expect(parseDefaultLanding('communication')).toBe('inbox')
    expect(parseDefaultLanding('overview')).toBe('today')
  })
})

describe('pathForDefaultLanding', () => {
  it('routes each start page', () => {
    expect(pathForDefaultLanding('new')).toBe('/communication/new')
    expect(pathForDefaultLanding('agenda')).toBe('/agenda')
    expect(pathForDefaultLanding('today')).toBe('/communication/today')
  })
})
