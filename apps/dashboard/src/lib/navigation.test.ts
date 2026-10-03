import { describe, expect, it } from 'vitest'

import {
  PINNED_TABS,
  TAB_GROUPS,
  TAB_PATHS,
  tabFromPath,
  titleForTab,
} from './navigation'

describe('navigation', () => {
  it('pins Overview above Control', () => {
    expect(PINNED_TABS).toEqual(['overview'])
    const control = TAB_GROUPS.find((g) => g.label === 'Control')
    expect(control?.tabs).not.toContain('overview')
  })

  it('has a Work group with projects and playbooks', () => {
    const work = TAB_GROUPS.find((g) => g.label === 'Work')
    expect(work?.tabs).toEqual(['projects', 'workstreams'])
    expect(titleForTab('workstreams')).toBe('Playbooks')
  })

  it('keeps Control to conversation-first destinations (Govern stays in Settings)', () => {
    const control = TAB_GROUPS.find((g) => g.label === 'Control')
    expect(control?.tabs).toEqual(['communication', 'agenda', 'team'])
    expect(TAB_PATHS).not.toHaveProperty('cases')
    expect(TAB_PATHS).not.toHaveProperty('activity')
    expect(TAB_PATHS).not.toHaveProperty('govern')
  })

  it('highlights Settings for Govern and other settings routes', () => {
    expect(tabFromPath('/settings/govern')).toBe('settings')
    expect(tabFromPath('/govern')).toBe('settings')
    expect(tabFromPath('/settings/channels')).toBe('settings')
  })

  it('no longer resolves a rail tab for the retired /cases hub', () => {
    expect(tabFromPath('/cases')).toBeNull()
    expect(tabFromPath('/settings/signals')).toBe('settings')
    expect(tabFromPath('/workstreams')).toBe('workstreams')
    expect(tabFromPath('/projects')).toBe('projects')
  })

  it('splits Connections from Settings in the rail', () => {
    const connections = TAB_GROUPS.find((g) => g.label === 'Connections')
    const settings = TAB_GROUPS.find((g) => g.label === 'Settings')
    expect(connections?.tabs).toEqual(['modules'])
    expect(settings?.tabs).toEqual(['settings'])
  })
})
