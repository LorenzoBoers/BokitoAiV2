import { describe, expect, it } from 'vitest'
import { normalizeSidebarPrefs } from './communication-sidebar-prefs'

describe('communication sidebar prefs', () => {
  it('folds legacy hashtags and projects into folders and inserts flows after folders', () => {
    const prefs = normalizeSidebarPrefs({
      order: ['hashtags', 'channels', 'projects', 'agents'],
      hidden: ['projects'],
      collapsed: ['hashtags'],
    })
    expect(prefs.order).toEqual(['folders', 'flows', 'channels', 'agents', 'teams', 'settings'])
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

  it('keeps view order and repairs a double-hidden inbox', () => {
    const prefs = normalizeSidebarPrefs({
      item_order: { inbox: ['queue:open', 'queue:for_you'] },
      hidden_items: ['queue:for_you', 'queue:open', 'queue:spam'],
    })
    expect(prefs.itemOrder.inbox).toEqual(['queue:open', 'queue:for_you'])
    expect(prefs.hiddenItems).toEqual(['queue:for_you', 'queue:spam'])
  })

  it('preserves an explicit flows section in order', () => {
    const prefs = normalizeSidebarPrefs({
      order: ['folders', 'flows', 'channels', 'teams', 'agents', 'settings'],
    })
    expect(prefs.order).toEqual(['folders', 'flows', 'channels', 'teams', 'agents', 'settings'])
  })
})
