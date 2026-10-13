/**
 * Persisted customization for the Communication hub's inner rail.
 *
 * Fixed at the top (never customizable): New chat + All communication.
 * Pinned at the bottom: Contacts and a single Settings link
 * (the 'settings' section flag only controls the link's visibility).
 * Middle sections (folders, flows, channels, agents, teams) can be reordered, hidden, collapsed.
 *
 * Stored in `/me/preferences.sidebar` and `rail_pins`; localStorage is a cache.
 */

export type SidebarSection = 'folders' | 'flows' | 'channels' | 'agents' | 'teams' | 'settings'

/** Sections that sit in the scrollable middle and can be reordered. */
export const MOVABLE_SECTIONS: readonly Exclude<SidebarSection, 'settings'>[] = [
  'folders',
  'flows',
  'channels',
  'agents',
  'teams',
]

export const ALL_SECTIONS: readonly SidebarSection[] = [...MOVABLE_SECTIONS, 'settings']

export const DEFAULT_SECTION_ORDER: readonly SidebarSection[] = ALL_SECTIONS

export type RailPin = {
  /** folder:<id>, tag:<name>, or path:<folderId>:<tagId> */
  ref: string
  position: number
}

export type SidebarPrefs = {
  /** Render order of sections (settings is always forced last by normalize). */
  order: SidebarSection[]
  /** Sections the user has hidden entirely. */
  hidden: SidebarSection[]
  /** Sections that start collapsed (header still visible). */
  collapsed: SidebarSection[]
  /** Folders whose sub-view list is expanded (folder scope keys). */
  expandedLeaves: string[]
  /** Personal pins shared by Communication and Agenda. */
  railPins: RailPin[]
  /** Workspace-default rows this person hid. */
  railHiddenDefaults: string[]
}

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = {
  order: [...DEFAULT_SECTION_ORDER],
  hidden: [],
  collapsed: [],
  expandedLeaves: [],
  railPins: [],
  railHiddenDefaults: [],
}

const STORAGE_KEY = 'communication-sidebar-prefs-v6'

function migrateSection(value: unknown): SidebarSection | null {
  if (value === 'hashtags' || value === 'projects' || value === 'folders') return 'folders'
  if (typeof value === 'string' && (ALL_SECTIONS as readonly string[]).includes(value)) {
    return value as SidebarSection
  }
  return null
}

/**
 * Keep Settings last; drop unknowns; fold old hashtags+projects into folders;
 * insert newly added movable sections in default relative order.
 */
function withSettingsLast(order: SidebarSection[]): SidebarSection[] {
  const middle: SidebarSection[] = []
  for (const section of order) {
    if (section === 'settings' || middle.includes(section)) continue
    middle.push(section)
  }
  for (const section of MOVABLE_SECTIONS) {
    if (middle.includes(section)) continue
    const defaultIdx = MOVABLE_SECTIONS.indexOf(section)
    let insertAt = middle.length
    for (let i = defaultIdx - 1; i >= 0; i -= 1) {
      const prior = MOVABLE_SECTIONS[i]
      const at = middle.indexOf(prior)
      if (at >= 0) {
        insertAt = at + 1
        break
      }
    }
    middle.splice(insertAt, 0, section)
  }
  return [...middle, 'settings']
}

function freshDefaults(): SidebarPrefs {
  return {
    ...DEFAULT_SIDEBAR_PREFS,
    order: [...DEFAULT_SECTION_ORDER],
    expandedLeaves: [],
    railPins: [],
    railHiddenDefaults: [],
  }
}

function normalizePins(raw: unknown): RailPin[] {
  if (!Array.isArray(raw)) return []
  const out: RailPin[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const ref = typeof row.ref === 'string' ? row.ref.trim() : ''
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    out.push({ ref, position: typeof row.position === 'number' ? row.position : out.length })
  }
  return out.sort((a, b) => a.position - b.position)
}

/** Repair stored prefs: drop unknown sections, append newly added ones. */
export function normalizeSidebarPrefs(raw: unknown): SidebarPrefs {
  if (!raw || typeof raw !== 'object') return freshDefaults()
  const data = raw as Partial<Record<string, unknown>>
  const rawOrder = Array.isArray(data.order) ? data.order : []
  const order = withSettingsLast(
    rawOrder.map(migrateSection).filter((s): s is SidebarSection => s != null),
  )
  const hidden = (
    Array.isArray(data.hidden) ? data.hidden.map(migrateSection).filter((s): s is SidebarSection => s != null) : []
  ) as SidebarSection[]
  const collapsed = (
    Array.isArray(data.collapsed)
      ? data.collapsed.map(migrateSection).filter((s): s is SidebarSection => s != null)
      : []
  ) as SidebarSection[]
  const expandedLeaves = Array.isArray(data.expandedLeaves)
    ? data.expandedLeaves.filter((v): v is string => typeof v === 'string')
    : Array.isArray(data.expanded_leaves)
      ? data.expanded_leaves.filter((v): v is string => typeof v === 'string')
      : []
  return {
    order,
    hidden: [...new Set(hidden)],
    collapsed: [...new Set(collapsed)],
    expandedLeaves,
    railPins: normalizePins(data.railPins ?? data.rail_pins),
    railHiddenDefaults: Array.isArray(data.railHiddenDefaults)
      ? data.railHiddenDefaults.filter((v): v is string => typeof v === 'string')
      : Array.isArray(data.rail_hidden_defaults)
        ? data.rail_hidden_defaults.filter((v): v is string => typeof v === 'string')
        : [],
  }
}

export function loadSidebarPrefs(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('communication-sidebar-prefs-v5')
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

export function folderPinRef(folderId: string): string {
  return `folder:${folderId}`
}

export function tagPinRef(name: string): string {
  return `tag:${name}`
}

export function pathPinRef(folderId: string, tagId: string): string {
  return `path:${folderId}:${tagId}`
}