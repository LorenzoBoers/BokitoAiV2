import { describe, expect, it } from 'vitest'
import { normalizeSidebarPrefs } from './communication-sidebar-prefs'

describe('communication sidebar prefs', () => {
  it('folds legacy hashtags and projects into folders', () => {
    const prefs = normalizeSidebarPrefs({
      order: ['hashtags', 'channels', 'projects', 'agents'],
      hidden: ['projects'],
      collapsed: ['hashtags'],
    })
    expect(prefs.order).toEqual(['folders', 'channels', 'agents', 'teams', 'settings'])
    expect(prefs.hidden).toEqual(['folders'])
    expect(prefs.collapsed).toEqual(['folders'])
  })

  it('keeps rail pins and hidden defaults', () => {
    const prefs = normalizeSidebarPrefs({
      rail_pins: [{ ref: 'tag:vip', position: 0 }, { ref: 'folder:1', position: 2 }],
      rail_hidden_defaults: ['tag:old'],
    })
    expect(prefs.railPins.map((pin) => pin.ref)).toEqual(['tag:vip', 'folder:1'])
    expect(prefs.railHiddenDefaults).toEqual(['tag:old'])
  })
})
