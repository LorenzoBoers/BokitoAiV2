/**
 * Persisted customization for the Communication hub's inner rail.
 *
 * Fixed at the top (never customizable): New chat + All communication.
 * Pinned at the bottom: Contacts and a single Settings link
 * (the 'settings' section flag only controls the link's visibility).
 * Middle sections (channels, agents, teams) can be reordered, hidden, collapsed.
 *
 * Note: the former chip model (channels/agents above the list) is gone — those
 * are folders again. Stored prefs that list unknown ids are repaired by
 * normalizeSidebarPrefs.
 */

export type SidebarSection = 'channels' | 'agents' | 'teams' | 'settings'

/** Sections that sit in the scrollable middle and can be reordered. */
export const MOVABLE_SECTIONS: readonly Exclude<SidebarSection, 'settings'>[] = [
  'channels',
  'agents',
  'teams',
]

export const ALL_SECTIONS: readonly SidebarSection[] = [...MOVABLE_SECTIONS, 'settings']

export const DEFAULT_SECTION_ORDER: readonly SidebarSection[] = ALL_SECTIONS

export type SidebarPrefs = {
  /** Render order of sections (settings is always forced last by normalize). */
  order: SidebarSection[]
  /** Sections the user has hidden entirely. */
  hidden: SidebarSection[]
  /** Sections that start collapsed (header still visible). */
  collapsed: SidebarSection[]
  /** Folders whose sub-view list is expanded (folder scope keys). */
  expandedLeaves: string[]
}

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = {
  order: [...DEFAULT_SECTION_ORDER],
  hidden: [],
  collapsed: [],
  expandedLeaves: [],
}

// v4: channels + agents folders restored alongside pinned teams.
const STORAGE_KEY = 'communication-sidebar-prefs-v4'

function isSection(value: unknown): value is SidebarSection {
  return typeof value === 'string' && (ALL_SECTIONS as readonly string[]).includes(value)
}

/** Keep Settings anchored last; drop unknowns. */
function withSettingsLast(order: SidebarSection[]): SidebarSection[] {
  const middle = order.filter((s) => s !== 'settings')
  for (const section of MOVABLE_SECTIONS) {
    if (middle.includes(section)) continue
    middle.push(section)
  }
  return [...middle, 'settings']
}

function freshDefaults(): SidebarPrefs {
  return { ...DEFAULT_SIDEBAR_PREFS, order: [...DEFAULT_SECTION_ORDER], expandedLeaves: [] }
}

/** Repair stored prefs: drop unknown sections, append newly added ones. */
export function normalizeSidebarPrefs(raw: unknown): SidebarPrefs {
  if (!raw || typeof raw !== 'object') return freshDefaults()
  const data = raw as Partial<Record<keyof SidebarPrefs, unknown>>
  const order = withSettingsLast(
    (Array.isArray(data.order) ? data.order.filter(isSection) : []) as SidebarSection[],
  )
  const hidden = (Array.isArray(data.hidden) ? data.hidden.filter(isSection) : []) as SidebarSection[]
  const collapsed = (Array.isArray(data.collapsed) ? data.collapsed.filter(isSection) : []) as SidebarSection[]
  const expandedLeaves = Array.isArray(data.expandedLeaves)
    ? data.expandedLeaves.filter((v): v is string => typeof v === 'string')
    : []
  return { order, hidden, collapsed, expandedLeaves }
}

export function loadSidebarPrefs(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return freshDefaults()
    return normalizeSidebarPrefs(JSON.parse(raw))
  } catch {
    return freshDefaults()
  }
}

export function saveSidebarPrefs(prefs: SidebarPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // ignore storage failures (private mode etc.)
  }
}
