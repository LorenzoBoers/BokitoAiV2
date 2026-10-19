import { describe, expect, it } from 'vitest'

import {
  PINNED_TABS,
  TAB_GROUPS,
  TAB_PATHS,
  isNewTab,
  markTabSeen,
  tabFromPath,
  titleForTab,
} from './navigation'

describe('navigation', () => {
  it('pins New chat, Overview and Communication above grouped sections', () => {
    expect(PINNED_TABS).toEqual(['newChat', 'overview', 'communication'])
    expect(TAB_PATHS.newChat).toBe('/new')
    expect(titleForTab('newChat')).toBe('New chat')
    expect(tabFromPath('/new')).toBe('newChat')
    expect(tabFromPath('/communication/new')).toBe('newChat')
    expect(TAB_GROUPS.find((g) => g.label === 'Control')).toBeUndefined()
  })

  it('has a Work group with folders, playbooks and agenda', () => {
    const work = TAB_GROUPS.find((g) => g.label === 'Work')
    expect(work?.tabs).toEqual(['folders', 'workstreams', 'agenda'])
    expect(titleForTab('workstreams')).toBe('Playbooks')
  })

  it('puts Grid under AI with Agents and Knowledge', () => {
    const ai = TAB_GROUPS.find((g) => g.label === 'AI')
    expect(ai?.tabs).toEqual(['agents', 'knowledge', 'grid'])
    expect(TAB_PATHS.grid).toBe('/grid')
    expect(tabFromPath('/grid')).toBe('grid')
    expect(tabFromPath('/team/canvas')).toBe('grid')
    expect(tabFromPath('/team')).toBe('team')
  })

  it('keeps the Grid New chip after markTabSeen (informational)', () => {
    expect(isNewTab('grid')).toBe(true)
    markTabSeen('grid')
    expect(isNewTab('grid')).toBe(true)
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
    expect(tabFromPath('/folders')).toBe('folders')
    expect(tabFromPath('/projects')).toBe('folders')
  })

  it('groups Team, Connections and Settings under Organization', () => {
    const organization = TAB_GROUPS.find((g) => g.label === 'Organization')
    expect(organization?.tabs).toEqual(['team', 'modules', 'settings'])
    expect(TAB_GROUPS.find((g) => g.label === 'Connections')).toBeUndefined()
    expect(TAB_GROUPS.find((g) => g.label === 'Settings')).toBeUndefined()
  })
})
