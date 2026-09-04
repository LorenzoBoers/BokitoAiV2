import { describe, expect, it } from 'vitest'

import { PINNED_TABS, TAB_GROUPS, TAB_PATHS, tabFromPath } from './navigation'

describe('navigation', () => {
  it('pins Overview above Control', () => {
    expect(PINNED_TABS).toEqual(['overview'])
    const control = TAB_GROUPS.find((g) => g.label === 'Control')
    expect(control?.tabs).not.toContain('overview')
  })

  it('has a Work group with projects and workstreams', () => {
    const work = TAB_GROUPS.find((g) => g.label === 'Work')
    expect(work?.tabs).toEqual(['projects', 'workstreams'])
  })

  it('lists cases under Control with its own path', () => {
    const control = TAB_GROUPS.find((g) => g.label === 'Control')
    expect(control?.tabs).toContain('cases')
    expect(TAB_PATHS.cases).toBe('/cases')
  })

  it('resolves the cases tab from /cases paths', () => {
    expect(tabFromPath('/cases')).toBe('cases')
    expect(tabFromPath('/cases?tab=types')).toBe('cases')
    expect(tabFromPath('/workstreams')).toBe('workstreams')
    expect(tabFromPath('/projects')).toBe('projects')
  })
})
