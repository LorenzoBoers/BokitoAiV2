import { loadPreferences, patchPreferences } from './preferences'
import {
  normalizeSidebarPrefs,
  type RailPin,
  type SidebarPrefs,
} from './communication-sidebar-prefs'

export function sidebarFromServer(raw: unknown): SidebarPrefs {
  if (!raw || typeof raw !== 'object') return normalizeSidebarPrefs(null)
  const data = raw as Record<string, unknown>
  return normalizeSidebarPrefs({
    order: data.order,
    hidden: data.hidden,
    collapsed: data.collapsed,
    expandedLeaves: data.expanded_leaves ?? data.expandedLeaves,
    railPins: data.rail_pins ?? data.railPins,
    railHiddenDefaults: data.rail_hidden_defaults ?? data.railHiddenDefaults,
    itemOrder: data.item_order ?? data.itemOrder,
    hiddenItems: data.hidden_items ?? data.hiddenItems,
  })
}

export async function fetchRailPrefs(token: string): Promise<SidebarPrefs> {
  const data = await loadPreferences(token)
  return sidebarFromServer({
    ...(typeof data.sidebar === 'object' && data.sidebar ? data.sidebar : {}),
    rail_pins: data.rail_pins,
    rail_hidden_defaults: data.rail_hidden_defaults,
  })
}

export async function saveRailPrefs(token: string, prefs: SidebarPrefs): Promise<void> {
  await patchPreferences(
    {
      sidebar: {
        order: prefs.order,
        hidden: prefs.hidden,
        collapsed: prefs.collapsed,
        expanded_leaves: prefs.expandedLeaves,
        item_order: prefs.itemOrder,
        hidden_items: prefs.hiddenItems,
      },
      rail_pins: prefs.railPins,
      rail_hidden_defaults: prefs.railHiddenDefaults,
    },
    token,
  )
}

export function togglePin(pins: RailPin[], ref: string): RailPin[] {
  if (pins.some((pin) => pin.ref === ref)) {
    return pins.filter((pin) => pin.ref !== ref).map((pin, index) => ({ ...pin, position: index }))
  }
  return [...pins, { ref, position: pins.length }]
}
