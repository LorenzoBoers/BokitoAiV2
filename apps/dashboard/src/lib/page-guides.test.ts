import { describe, expect, it } from 'vitest'

import { isPageGuideSlug, pageGuidePath, PAGE_GUIDE_SLUGS } from './page-guides'

describe('page guides', () => {
  it('accepts known slugs and rejects others', () => {
    expect(isPageGuideSlug('agents')).toBe(true)
    expect(isPageGuideSlug('communication')).toBe(true)
    expect(isPageGuideSlug(undefined)).toBe(false)
  })

  it('builds in-app learn paths', () => {
    expect(pageGuidePath('agenda')).toBe('/learn/agenda')
    expect(PAGE_GUIDE_SLUGS).toContain('govern')
  })
})
