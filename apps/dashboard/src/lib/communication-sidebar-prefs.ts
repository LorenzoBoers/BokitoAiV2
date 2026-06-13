/**
 * Persisted customization for the Communication hub's inner rail.
 *
 * Fixed at the top (never customizable): New chat + Inbox.
 * Everything below is a section the user can reorder, hide, and collapse.
 */

export type SidebarSection =
  | 'assistant'
  | 'channels'
  | 'agents'
  | 'settings'

export const ALL_SECTIONS: readonly SidebarSection[] = [
  'assistant',
  'channels',
  'agents',
  'settings',
]

export const DEFAULT_SECTION_ORDER: readonly SidebarSection[] = ALL_SECTIONS

export type SidebarPrefs = {
  /** Render order of the customizable sections. */
  order: SidebarSection[]
  /** Sections the user has hidden entirely. */
  hidden: SidebarSection[]
  /** Sections that start collapsed (header still visible). */
  collapsed: SidebarSection[]
}

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = {
  order: [...DEFAULT_SECTION_ORDER],
  hidden: [],
  collapsed: [],
}

const STORAGE_KEY = 'communication-sidebar-prefs'

function isSection(value: unknown): value is SidebarSection {
  return typeof value === 'string' && (ALL_SECTIONS as readonly string[]).includes(value)
}

/** Repair stored prefs: drop unknown sections, append newly added ones. */
export function normalizeSidebarPrefs(raw: unknown): SidebarPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SIDEBAR_PREFS, order: [...DEFAULT_SECTION_ORDER] }
  const data = raw as Partial<Record<keyof SidebarPrefs, unknown>>
  const order = (Array.isArray(data.order) ? data.order.filter(isSection) : []) as SidebarSection[]
  for (const section of ALL_SECTIONS) {
    if (!order.includes(section)) order.push(section)
  }
  const hidden = (Array.isArray(data.hidden) ? data.hidden.filter(isSection) : []) as SidebarSection[]
  const collapsed = (Array.isArray(data.collapsed) ? data.collapsed.filter(isSection) : []) as SidebarSection[]
  return { order, hidden, collapsed }
}

export function loadSidebarPrefs(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SIDEBAR_PREFS, order: [...DEFAULT_SECTION_ORDER] }
    return normalizeSidebarPrefs(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SIDEBAR_PREFS, order: [...DEFAULT_SECTION_ORDER] }
  }
}

export function saveSidebarPrefs(prefs: SidebarPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // ignore storage failures (private mode etc.)
  }
}
