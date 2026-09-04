/**
 * Persisted customization for the Communication hub's inner rail.
 *
 * Fixed at the top (never customizable): New chat + All communication.
 * Pinned at the bottom: Activity, Contacts, and a single Settings link
 * (the 'settings' section flag only controls the link's visibility).
 * Middle sections (bokito, channels, agents, tags) can be reordered, hidden,
 * collapsed.
 *
 * Note: the former 'assistant' section was merged into 'agents'. Stored prefs
 * that still list 'assistant' are repaired by normalizeSidebarPrefs. 'bokito'
 * is something else: the user's own helper threads, which are private and are
 * never a company agent chat.
 */

export type SidebarSection = 'bokito' | 'agents' | 'channels' | 'tags' | 'settings'

/** Sections that sit in the scrollable middle and can be reordered. */
export const MOVABLE_SECTIONS: readonly Exclude<SidebarSection, 'settings'>[] = [
  'bokito',
  'channels',
  'agents',
  'tags',
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
  /** Channel/tag folders whose sub-view list is expanded (folder scope keys). */
  expandedLeaves: string[]
}

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = {
  order: [...DEFAULT_SECTION_ORDER],
  hidden: [],
  collapsed: [],
  expandedLeaves: [],
}

// v2: channels-before-agents default order; settings collapsed into one link.
const STORAGE_KEY = 'communication-sidebar-prefs-v2'

function isSection(value: unknown): value is SidebarSection {
  return typeof value === 'string' && (ALL_SECTIONS as readonly string[]).includes(value)
}

/** Keep Settings anchored last; drop unknowns (e.g. legacy 'assistant'). */
function withSettingsLast(order: SidebarSection[]): SidebarSection[] {
  const middle = order.filter((s) => s !== 'settings')
  for (const section of MOVABLE_SECTIONS) {
    if (middle.includes(section)) continue
    // Bokito is the user's own helper, so it opens the rail rather than
    // landing under the tenant's channels when older prefs are repaired.
    if (section === 'bokito') middle.unshift(section)
    else middle.push(section)
  }
  return [...middle, 'settings']
}

function freshDefaults(): SidebarPrefs {
  return { ...DEFAULT_SIDEBAR_PREFS, order: [...DEFAULT_SECTION_ORDER], expandedLeaves: [] }
}

/** Repair stored prefs: drop unknown sections (e.g. legacy 'assistant'), append newly added ones. */
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
