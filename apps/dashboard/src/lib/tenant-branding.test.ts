import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_MARK,
  brandStyleVars,
  resolveBrandIconUrl,
  workspaceBrandName,
} from './tenant-branding'


describe('resolveBrandIconUrl', () => {
  it('prefers an explicit widget icon, then favicon, then logo', () => {
    expect(
      resolveBrandIconUrl({
        widgetFaviconUrl: 'https://cdn.example/widget.png',
        favicon: 'https://cdn.example/fav.png',
        logo: 'https://cdn.example/logo.png',
      }),
    ).toBe('https://cdn.example/widget.png')
    expect(resolveBrandIconUrl({ favicon: 'https://cdn.example/fav.png', logo: 'https://cdn.example/logo.png' })).toBe(
      'https://cdn.example/fav.png',
    )
    expect(resolveBrandIconUrl({ logo: 'https://cdn.example/logo.png' })).toBe('https://cdn.example/logo.png')
    expect(resolveBrandIconUrl({ logo: '/bokito-logo.png' })).toBeNull()
    expect(resolveBrandIconUrl({ logo: '/bokito-logo.svg' })).toBeNull()
    expect(resolveBrandIconUrl({})).toBeNull()
  })
})

describe('workspaceBrandName', () => {
  it('uses the tenant name and falls back to Bokito', () => {
    expect(workspaceBrandName({ name: 'Bourgondiënadvies' })).toBe('Bourgondiënadvies')
    expect(workspaceBrandName({ name: '  ' })).toBe('Bokito')
    expect(workspaceBrandName(null)).toBe('Bokito')
    expect(DEFAULT_BRAND_MARK).toBe('/bokito-logo.png')
  })
})

describe('brandStyleVars', () => {
  it('writes every accent token for the platform mint with white button text', () => {
    expect(DEFAULT_BRAND_COLOR).toBe('#32BF8E')
    const vars = brandStyleVars(null, 'light')
    expect(vars['--color-accent-fg']).toBe('255 255 255')
    expect(vars['--color-accent']).toMatch(/^\d+ \d+ \d+$/)
    expect(vars['--body-glow-top'].startsWith('rgba(')).toBe(true)
  })

  it('turns white into neutral tokens without a glow', () => {
    const vars = brandStyleVars('#FFFFFF', 'dark')
    const [r, g, b] = vars['--color-accent'].split(' ').map(Number)
    expect(r).toBe(g)
    expect(g).toBe(b)
    expect(vars['--body-glow-top']).toMatch(/, 0\)$/)
  })
})

