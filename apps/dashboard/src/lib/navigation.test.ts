import { describe, expect, it } from 'vitest'

import {
  PINNED_TABS,
  TAB_GROUPS,
  TAB_PATHS,
  tabFromPath,
  titleForTab,
} from './navigation'

describe('navigation', () => {
  it('pins Overview and Communication above grouped sections', () => {
    expect(PINNED_TABS).toEqual(['overview', 'communication'])
    expect(TAB_GROUPS.find((g) => g.label === 'Control')).toBeUndefined()
  })

  it('has a Work group with projects, playbooks and agenda', () => {
    const work = TAB_GROUPS.find((g) => g.label === 'Work')
    expect(work?.tabs).toEqual(['projects', 'workstreams', 'agenda'])
    expect(titleForTab('workstreams')).toBe('Playbooks')
  })

  it('keeps Govern out of the primary rail', () => {
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
    expect(tabFromPath('/settings/action-tags')).toBe('settings')
    expect(tabFromPath('/workstreams')).toBe('workstreams')
    expect(tabFromPath('/projects')).toBe('projects')
  })

  it('groups Team, Connections and Settings under Organization', () => {
    const organization = TAB_GROUPS.find((g) => g.label === 'Organization')
    expect(organization?.tabs).toEqual(['team', 'modules', 'settings'])
    expect(TAB_GROUPS.find((g) => g.label === 'Connections')).toBeUndefined()
    expect(TAB_GROUPS.find((g) => g.label === 'Settings')).toBeUndefined()
  })
})
