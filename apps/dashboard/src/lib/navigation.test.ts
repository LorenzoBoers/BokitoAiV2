import { describe, expect, it } from 'vitest'

import {
  CONNECTIONS_PATH,
  FOOTER_TAB,
  FOOTER_TABS,
  GRID_PATH,
  KNOWLEDGE_PATH,
  OVERVIEW_PATH,
  PINNED_TABS,
  TAB_GROUPS,
  TAB_PATHS,
  tabFromPath,
} from './navigation'

describe('navigation', () => {
  it('pins Inbox above Work and Connections above the account divider', () => {
    expect(PINNED_TABS).toEqual(['communication'])
    expect(TAB_GROUPS).toEqual([
      { label: 'work', tabs: ['agenda', 'folders', 'workstreams'] },
      { label: 'team', tabs: ['agents', 'team'] },
    ])
    expect(FOOTER_TABS).toEqual(['connections', 'settings'])
    expect(FOOTER_TAB).toBe('settings')
    expect(TAB_PATHS).not.toHaveProperty('newChat')
    expect(tabFromPath('/new')).toBeNull()
  })

  it('nests Today, Knowledge and Grid under their parent tab', () => {
    expect(tabFromPath(OVERVIEW_PATH)).toBe('communication')
    expect(tabFromPath(KNOWLEDGE_PATH)).toBe('agents')
    expect(tabFromPath(GRID_PATH)).toBe('team')
    expect(tabFromPath(CONNECTIONS_PATH)).toBe('connections')
    expect(tabFromPath('/connections/accounting')).toBe('connections')
    expect(tabFromPath('/settings/connections')).toBe('connections')
    expect(tabFromPath('/workforce')).toBe('team')
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
    expect(tabFromPath('/settings/labels')).toBe('settings')
    expect(tabFromPath('/flows')).toBe('workstreams')
    expect(tabFromPath('/folders')).toBe('folders')
    expect(tabFromPath('/projects')).toBe('folders')
  })

  it('keeps nested destinations on their paths', () => {
    expect(TAB_PATHS.team).toBe('/workforce')
    expect(GRID_PATH).toBe('/workforce/grid')
    expect(KNOWLEDGE_PATH).toBe('/agents/knowledge')
    expect(CONNECTIONS_PATH).toBe('/connections')
    expect(OVERVIEW_PATH).toBe('/communication/today')
  })
})
