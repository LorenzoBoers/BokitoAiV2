/**
 * Navigation model for the control shell.
 *
 * Rail: Overview + Communication (pinned); Work (Projects, Playbooks, Agenda);
 * AI (Agents, Knowledge); Organization (Team, Connections, Settings).
 * Govern lives under Settings (not a primary rail item).
 * Overview is the former Reports/Cockpit surface (path stays `/cockpit`).
 */

import {
  Bot,
  Brain,
  CalendarDays,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export type Tab =
  | 'overview'
  | 'communication'
  | 'agenda'
  | 'team'
  | 'agents'
  | 'workstreams'
  | 'knowledge'
  | 'projects'
  | 'modules'
  | 'settings'

export const PINNED_TABS: readonly Tab[] = ['overview', 'communication']

export const TAB_GROUPS: ReadonlyArray<{ label: string; tabs: readonly Tab[] }> = [
  { label: 'Work', tabs: ['projects', 'workstreams', 'agenda'] },
  { label: 'AI', tabs: ['agents', 'knowledge'] },
  { label: 'Organization', tabs: ['team', 'modules', 'settings'] },
]

export const TAB_PATHS: Record<Tab, string> = {
  overview: '/cockpit',
  communication: '/communication/inbox/for_you',
  agenda: '/agenda',
  team: '/team',
  agents: '/agents',
  workstreams: '/workstreams',
  knowledge: '/knowledge',
  projects: '/projects',
  modules: '/connections',
  settings: '/settings',
}

/** @deprecated Schedules now live on the single Agenda trigger timeline. */
export const AGENDA_AUTOMATIONS_PATH = '/agenda' as const

/** Overview (former Cockpit / Reports): daily scan, activity and usage. */
export const OVERVIEW_PATH = '/cockpit' as const

/** @deprecated Use OVERVIEW_PATH — kept for older imports. */
export const REPORTS_PATH = OVERVIEW_PATH

const TAB_ICONS: Record<Tab, LucideIcon> = {
  overview: LayoutDashboard,
  communication: MessageSquare,
  agenda: CalendarDays,
  team: Users,
  agents: Bot,
  workstreams: Workflow,
  knowledge: Brain,
  projects: FolderKanban,
  modules: Plug,
  settings: Settings,
}

const TAB_TITLES: Record<Tab, string> = {
  overview: 'Overview',
  communication: 'Communication',
  agenda: 'Agenda',
  team: 'Workforce',
  agents: 'Agents',
  workstreams: 'Playbooks',
  knowledge: 'Knowledge',
  projects: 'Projects',
  modules: 'Connections',
  settings: 'Settings',
}

const TAB_SUBTITLES: Record<Tab, string> = {
  overview: 'Daily scan, attention and usage',
  communication: 'Chats, customer and agent threads',
  agenda: 'Planned and past trigger occurrences',
  team: 'People, agents and teams of the company',
  agents: 'People and agents you can chat with',
  workstreams: 'Repeatable step-by-step playbooks for agents',
  knowledge: 'Docs, skills and memory',
  projects: 'Shared goals, agents and playbooks for a body of work',
  modules: 'Installed modules, partner logins and tools',
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
  if (pathname.startsWith('/team')) return 'team'
  if (pathname.startsWith('/agents')) return 'agents'
  if (pathname.startsWith('/workstreams')) return 'workstreams'
  if (pathname.startsWith('/projects')) return 'projects'
  if (
    pathname.startsWith('/knowledge') ||
    pathname.startsWith('/workspace') ||
    pathname.startsWith('/skills')
  )
    return 'knowledge'
  // Hub routes highlight Connections; installed module workspaces use their own rail item.
  if (pathname === '/connections' || pathname.startsWith('/connections/marketplace'))
    return 'modules'
  if (pathname.startsWith('/connections/')) return null
  // Installed module workspaces live under the Modules group, not Settings.
  if (pathname.startsWith('/ai/modules')) return null
  // Activity terminal is shared; highlight Communication when opened from hub.
  if (pathname.startsWith('/activity')) return 'communication'
  if (pathname.startsWith('/settings') || pathname.startsWith('/ai/') || pathname.startsWith('/govern'))
    return 'settings'
  return null
}
