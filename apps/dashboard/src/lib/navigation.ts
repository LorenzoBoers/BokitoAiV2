/**
 * Navigation model for the control shell.
 *
 * Rail: New chat, Overview + Communication (pinned); Work (Folders, Playbooks, Agenda);
 * AI (Agents, Knowledge, Grid); Organization (Team, Connections, Settings).
 * Govern lives under Settings (not a primary rail item).
 * Overview is the former Reports/Cockpit surface (path stays `/cockpit`).
 */

import {
  Bot,
  Brain,
  CalendarDays,
  FolderOpen,
  LayoutDashboard,
  MessageSquare,
  Network,
  Plug,
  Settings,
  SquarePen,
  Route,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type Tab =
  | 'newChat'
  | 'overview'
  | 'communication'
  | 'agenda'
  | 'team'
  | 'agents'
  | 'workstreams'
  | 'knowledge'
  | 'grid'
  | 'folders'
  | 'modules'
  | 'settings'

export const PINNED_TABS: readonly Tab[] = ['newChat', 'overview', 'communication']

export const TAB_GROUPS: ReadonlyArray<{ label: string; tabs: readonly Tab[] }> = [
  { label: 'Work', tabs: ['folders', 'workstreams', 'agenda'] },
  { label: 'AI', tabs: ['agents', 'knowledge', 'grid'] },
  { label: 'Organization', tabs: ['team', 'modules', 'settings'] },
]

export const TAB_PATHS: Record<Tab, string> = {
  newChat: '/new',
  overview: '/cockpit',
  communication: '/communication/inbox/for_you',
  agenda: '/agenda',
  team: '/team',
  agents: '/agents',
  workstreams: '/workstreams',
  knowledge: '/knowledge',
  grid: '/grid',
  folders: '/folders',
  modules: '/connections',
  settings: '/settings',
}

/** @deprecated Schedules now live on the single Agenda trigger timeline. */
export const AGENDA_AUTOMATIONS_PATH = '/agenda' as const

/** Overview (former Cockpit / Reports): daily scan, activity and usage. */
export const OVERVIEW_PATH = '/cockpit' as const

/** @deprecated Use OVERVIEW_PATH — kept for older imports. */
export const REPORTS_PATH = OVERVIEW_PATH

/** Org map mark. Same glyph on the rail, Open in Grid, and the departments link. */
export const GRID_ICON: LucideIcon = Network

const TAB_ICONS: Record<Tab, LucideIcon> = {
  newChat: SquarePen,
  overview: LayoutDashboard,
  communication: MessageSquare,
  agenda: CalendarDays,
  team: Users,
  agents: Bot,
  workstreams: Route,
  knowledge: Brain,
  grid: GRID_ICON,
  folders: FolderOpen,
  modules: Plug,
  settings: Settings,
}

const TAB_TITLES: Record<Tab, string> = {
  newChat: 'New chat',
  overview: 'Overview',
  communication: 'Communication',
  agenda: 'Agenda',
  team: 'Workforce',
  agents: 'Agents',
  workstreams: 'Playbooks',
  knowledge: 'Knowledge',
  grid: 'Grid',
  folders: 'Folders',
  modules: 'Connections',
  settings: 'Settings',
}

const TAB_SUBTITLES: Record<Tab, string> = {
  newChat: 'Start a conversation',
  overview: 'Daily scan, attention and usage',
  communication: 'Chats, customer and agent threads',
  agenda: 'Planned and past trigger occurrences',
  team: 'People, agents and teams of the company',
  agents: 'People and agents you can chat with',
  workstreams: 'Repeatable step-by-step playbooks for agents',
  knowledge: 'Docs, skills and memory',
  grid: 'Organization map: departments, people, agents and links',
  folders: 'A tag with a place: conversations, boards and docs under one path',
  modules: 'Installed modules, partner logins and tools',
  settings: 'Workspace configuration',
}

/** Tabs that show a temporary "New" rail label (not a count badge). */
const NEW_TABS: ReadonlySet<Tab> = new Set(['modules', 'grid'])

/**
 * New chips that stay until removed from NEW_TABS (not cleared on open).
 * Grid stays informational while the map is still being discovered.
 */
const PERSISTENT_NEW_TABS: ReadonlySet<Tab> = new Set(['grid'])

/**
 * Bump a tab's revision when the New chip should reappear for everyone
 * (e.g. Grid shipped after an earlier accidental mark-as-seen).
 */
const NEW_TAB_REVISIONS: Partial<Record<Tab, string>> = {
  grid: 'v2',
}

const NEW_TAB_SEEN_PREFIX = 'bokito.nav.newTab.seen.'

function newTabSeenKey(tab: Tab): string {
  const rev = NEW_TAB_REVISIONS[tab]
  return rev ? `${NEW_TAB_SEEN_PREFIX}${tab}.${rev}` : `${NEW_TAB_SEEN_PREFIX}${tab}`
}

export function iconForTab(tab: Tab): LucideIcon {
  return TAB_ICONS[tab]
}

export function titleForTab(tab: Tab): string {
  return TAB_TITLES[tab]
}

export function subtitleForTab(tab: Tab): string {
  return TAB_SUBTITLES[tab]
}

export function pathForTab(tab: Tab): string {
  return TAB_PATHS[tab]
}

export function isNewTab(tab: Tab): boolean {
  if (!NEW_TABS.has(tab)) return false
  try {
    return localStorage.getItem(newTabSeenKey(tab)) !== '1'
  } catch {
    return true
  }
}

/** Clear the temporary "New" rail badge after the user opens that area. */
export function markTabSeen(tab: Tab): void {
  if (!NEW_TABS.has(tab) || PERSISTENT_NEW_TABS.has(tab)) return
  try {
    localStorage.setItem(newTabSeenKey(tab), '1')
  } catch {
    // ignore storage failures
  }
}

/** Resolve the active tab from a pathname (longest-prefix match). */
export function tabFromPath(pathname: string): Tab | null {
  if (pathname === '/new' || pathname.startsWith('/new/') || pathname.startsWith('/communication/new'))
    return 'newChat'
  if (
    pathname.startsWith('/cockpit') ||
    pathname.startsWith('/overview') ||
    pathname === '/home' ||
    pathname.startsWith('/usage')
  )
    return 'overview'
  if (pathname === '/' || pathname.startsWith('/communication') || pathname.startsWith('/inbox'))
    return 'communication'
  // Contacts nest under Communication.
  if (pathname.startsWith('/contacts')) return 'communication'
  if (pathname.startsWith('/agenda')) return 'agenda'
  if (pathname === '/grid' || pathname.startsWith('/team/canvas')) return 'grid'
  if (pathname.startsWith('/team')) return 'team'
  if (pathname.startsWith('/agents')) return 'agents'
  if (pathname.startsWith('/workstreams')) return 'workstreams'
  if (pathname.startsWith('/folders') || pathname.startsWith('/projects')) return 'folders'
  if (
    pathname.startsWith('/knowledge') ||
    pathname.startsWith('/workspace') ||
    pathname.startsWith('/skills')
  )
    return 'knowledge'
  // Hub routes highlight Connections; installed module workspaces use their own rail item.
  if (pathname === '/connections') return 'modules'
  if (pathname.startsWith('/connections/')) return null
  // Installed module workspaces live under the Modules group, not Settings.
  if (pathname.startsWith('/ai/modules')) return null
  // Activity terminal is shared; highlight Communication when opened from hub.
  if (pathname.startsWith('/settings') || pathname.startsWith('/ai/') || pathname.startsWith('/govern'))
    return 'settings'
  return null
}
