import { describe, expect, it } from 'vitest'
import {
  PLATFORM_ICON_POPULAR,
  filterPlatformIcons,
  platformIcon,
  platformIconIds,
} from './platform-icons'

describe('platform-icons', () => {
  it('exposes a large Lucide kebab set', () => {
    const ids = platformIconIds()
    expect(ids.length).toBeGreaterThan(1000)
    expect(ids).toContain('route')
    expect(ids).toContain('building-2')
    expect(ids).toContain('flask-conical')
  })

  it('resolves known Lucide components', () => {
    expect(platformIcon('route')).toBeTruthy()
    expect(platformIcon('message-circle')).toBeTruthy()
    expect(platformIcon('not-a-real-icon')).toBeNull()
    expect(platformIcon(null)).toBeNull()
  })

  it('empty query returns popular first then the full Lucide set', () => {
    const list = filterPlatformIcons('')
    expect(list.length).toBe(platformIconIds().length)
    expect(list[0]).toBe(PLATFORM_ICON_POPULAR[0])
    expect(list.slice(0, PLATFORM_ICON_POPULAR.length)).toEqual([...PLATFORM_ICON_POPULAR])

    const withSelected = filterPlatformIcons('', 'accessibility')
    expect(withSelected[0]).toBe('accessibility')
    expect(withSelected.length).toBe(platformIconIds().length)
  })

  it('search matches id substring and EN/NL aliases', () => {
    const byId = filterPlatformIcons('truck')
    expect(byId).toContain('truck')

    const byAlias = filterPlatformIcons('klantenservice')
    expect(byAlias).toContain('headset')

    const byNl = filterPlatformIcons('factuur')
    expect(byNl).toContain('receipt')
  })
})
