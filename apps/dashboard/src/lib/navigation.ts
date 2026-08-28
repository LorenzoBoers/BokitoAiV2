/**
 * Navigation model for the control shell.
 *
 * Target rail: Cockpit, Communication, Contacts, Agenda, Projects,
 * Agents, Knowledge, Modules, Settings. Cockpit hosts Overview/Activity/Usage
 * as inner tabs; Knowledge hosts workspace docs including skills and memory.
 */

import {
  Bot,
  Boxes,
  Brain,
  CalendarDays,
  Contact,
  FolderKanban,
  Gauge,
  MessageSquare,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export type Tab =
  | 'cockpit'
  | 'communication'
  | 'contacts'
  | 'agenda'
  | 'agents'
  | 'projects'
  | 'knowledge'
  | 'modules'
  | 'settings'

export const TAB_GROUPS: ReadonlyArray<{ label: string; tabs: readonly Tab[] }> = [
  { label: 'Control', tabs: ['cockpit', 'communication', 'contacts', 'agenda', 'projects'] },
  { label: 'AI', tabs: ['agents', 'knowledge'] },
  { label: 'Settings', tabs: ['modules', 'settings'] },
]

export const TAB_PATHS: Record<Tab, string> = {
  cockpit: '/cockpit',
  communication: '/communication/inbox/open',
  contacts: '/contacts',
  agenda: '/agenda',
  agents: '/agents',
  projects: '/projects',
  knowledge: '/knowledge',
  modules: '/modules',
  settings: '/settings',
}

/** Scheduled flows and recurring wakes — not the week calendar. */
export const AGENDA_AUTOMATIONS_PATH = '/agenda?view=automations' as const

const TAB_ICONS: Record<Tab, LucideIcon> = {
  cockpit: Gauge,
  communication: MessageSquare,
  contacts: Contact,
  agenda: CalendarDays,
  agents: Bot,
  projects: FolderKanban,
  // Knowledge identity: violet brain, recurring across the platform.
  knowledge: Brain,
  modules: Boxes,
  settings: Settings,
}

const TAB_TITLES: Record<Tab, string> = {
  cockpit: 'Cockpit',
  communication: 'Communication',
  contacts: 'Contacts',
  agenda: 'Agenda',
  agents: 'Agents',
  projects: 'Projects',
  knowledge: 'Knowledge',
  modules: 'Modules',
  settings: 'Settings',
}

const TAB_SUBTITLES: Record<Tab, string> = {
  cockpit: 'Overview, activity and usage',
  communication: 'Chats, customer and agent threads',
  contacts: 'People across your channels',
  agenda: 'Scheduled wakes, tasks and events',
  agents: 'People and agents you can chat with',
  projects: 'Shared goals for agents and threads',
  knowledge: 'Docs, skills and memory',
  modules: 'Business capabilities, packages and sources',
  settings: 'Workspace configuration',
}

/** Tabs that show a temporary "New" rail label (not a count badge). */
const NEW_TABS: ReadonlySet<Tab> = new Set(['modules'])

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
  return NEW_TABS.has(tab)
}

/** Resolve the active tab from a pathname (longest-prefix match). */
export function tabFromPath(pathname: string): Tab | null {
  if (pathname === '/' || pathname.startsWith('/communication') || pathname.startsWith('/inbox'))
    return 'communication'
  if (
    pathname.startsWith('/cockpit') ||
    pathname.startsWith('/overview') ||
    pathname.startsWith('/activity') ||
    pathname.startsWith('/usage')
  )
    return 'cockpit'
  if (pathname.startsWith('/contacts')) return 'contacts'
  if (pathname.startsWith('/agenda')) return 'agenda'
  if (pathname.startsWith('/agents')) return 'agents'
  if (pathname.startsWith('/projects')) return 'projects'
  if (
    pathname.startsWith('/knowledge') ||
    pathname.startsWith('/workspace') ||
    pathname.startsWith('/skills')
  )
    return 'knowledge'
  if (pathname.startsWith('/modules')) return 'modules'
  if (pathname.startsWith('/settings') || pathname.startsWith('/ai/')) return 'settings'
  return null
}
