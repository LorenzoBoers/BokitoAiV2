/**
 * Navigation model for the control shell.
 *
 * Rail: Communication, Agenda, Projects, Agents, Modules, Settings (6).
 * Cockpit is demoted to a Reports view under Settings; Contacts nests under
 * Communication; Knowledge nests under the Agents (AI) group.
 */

import {
  Bot,
  Boxes,
  CalendarDays,
  FolderKanban,
  MessageSquare,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export type Tab =
  | 'communication'
  | 'agenda'
  | 'agents'
  | 'projects'
  | 'modules'
  | 'settings'

export const TAB_GROUPS: ReadonlyArray<{ label: string; tabs: readonly Tab[] }> = [
  { label: 'Control', tabs: ['communication', 'agenda', 'projects'] },
  { label: 'AI', tabs: ['agents'] },
  { label: 'Settings', tabs: ['modules', 'settings'] },
]

export const TAB_PATHS: Record<Tab, string> = {
  communication: '/communication/inbox/open',
  agenda: '/agenda',
  agents: '/agents',
  projects: '/projects',
  modules: '/modules',
  settings: '/settings',
}

/** Scheduled flows and recurring wakes — not the week calendar. */
export const AGENDA_AUTOMATIONS_PATH = '/agenda?view=automations' as const

/** Reports (former Cockpit): overview, activity and usage, linked from Settings. */
export const REPORTS_PATH = '/cockpit' as const

const TAB_ICONS: Record<Tab, LucideIcon> = {
  communication: MessageSquare,
  agenda: CalendarDays,
  agents: Bot,
  projects: FolderKanban,
  modules: Boxes,
  settings: Settings,
}

const TAB_TITLES: Record<Tab, string> = {
  communication: 'Communication',
  agenda: 'Agenda',
  agents: 'Agents',
  projects: 'Projects',
  modules: 'Modules',
  settings: 'Settings',
}

const TAB_SUBTITLES: Record<Tab, string> = {
  communication: 'Chats, customer and agent threads',
  agenda: 'Scheduled wakes, tasks and events',
  agents: 'People and agents you can chat with',
  projects: 'Shared goals for agents and threads',
  modules: 'Business capabilities, packages and sources',
  settings: 'Workspace configuration',
}

/** Tabs that show a temporary "New" rail label (not a count badge). */
const NEW_TABS: ReadonlySet<Tab> = new Set(['modules'])

const NEW_TAB_SEEN_PREFIX = 'bokito.nav.newTab.seen.'

function newTabSeenKey(tab: Tab): string {
  return `${NEW_TAB_SEEN_PREFIX}${tab}`
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
  if (!NEW_TABS.has(tab)) return
  try {
    localStorage.setItem(newTabSeenKey(tab), '1')
  } catch {
    // ignore storage failures
  }
}

/** Resolve the active tab from a pathname (longest-prefix match). */
export function tabFromPath(pathname: string): Tab | null {
  if (pathname === '/' || pathname.startsWith('/communication') || pathname.startsWith('/inbox'))
    return 'communication'
  // Contacts nest under Communication.
  if (pathname.startsWith('/contacts')) return 'communication'
  if (pathname.startsWith('/agenda')) return 'agenda'
  if (pathname.startsWith('/agents')) return 'agents'
  if (pathname.startsWith('/projects')) return 'projects'
  // Knowledge nests under the Agents (AI) group.
  if (
    pathname.startsWith('/knowledge') ||
    pathname.startsWith('/workspace') ||
    pathname.startsWith('/skills')
  )
    return 'agents'
  if (pathname.startsWith('/modules')) return 'modules'
  // Installed module workspaces live under AI, not Settings.
  if (pathname.startsWith('/ai/modules')) return null
  // Reports (former Cockpit) is reached from Settings.
  if (
    pathname.startsWith('/cockpit') ||
    pathname.startsWith('/overview') ||
    pathname.startsWith('/activity') ||
    pathname.startsWith('/usage')
  )
    return 'settings'
  if (pathname.startsWith('/settings') || pathname.startsWith('/ai/')) return 'settings'
  return null
}
