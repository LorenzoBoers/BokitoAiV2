/**
 * Navigation model for the control shell.
 *
 * Rail: New conversation on top; Work (Communication, Agenda, Folders, Flows);
 * Team (Agents, Workforce); Settings in the footer above the account menu.
 * Today lives inside Communication, Knowledge under Agents, Grid under
 * Workforce, Connections and Govern under Settings.
 */

import {
  Bot,
  CalendarDays,
  FolderOpen,
  MessageSquare,
  Network,
  Route,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type Tab = 'communication' | 'agenda' | 'folders' | 'workstreams' | 'agents' | 'team' | 'settings'

export type TabGroup = { label: 'work' | 'team'; tabs: readonly Tab[] }

export const TAB_GROUPS: readonly TabGroup[] = [
  { label: 'work', tabs: ['communication', 'agenda', 'folders', 'workstreams'] },
  { label: 'team', tabs: ['agents', 'team'] },
]

/** Rendered in the sidebar footer, not inside a group. */
export const FOOTER_TAB: Tab = 'settings'

export const TAB_PATHS: Record<Tab, string> = {
  communication: '/communication/inbox/for_you',
  agenda: '/agenda',
  folders: '/folders',
  workstreams: '/flows',
  agents: '/agents',
  team: '/workforce',
  settings: '/settings',
}

/** Today: daily scan and attention, first item inside Communication. */
export const OVERVIEW_PATH = '/communication/today' as const
export const KNOWLEDGE_PATH = '/agents/knowledge' as const
export const GRID_PATH = '/workforce/grid' as const
export const DEPARTMENTS_PATH = '/workforce?tab=departments' as const
export const CONNECTIONS_PATH = '/settings/connections' as const
export const AUTONOMY_PATH = '/settings/govern?tab=policy' as const

/** Org map mark. Same glyph on Open in Grid and the Grid tab. */
export const GRID_ICON: LucideIcon = Network

const TAB_ICONS: Record<Tab, LucideIcon> = {
  communication: MessageSquare,
  agenda: CalendarDays,
  folders: FolderOpen,
  workstreams: Route,
  agents: Bot,
  team: Users,
  settings: Settings,
}

const TAB_TITLES: Record<Tab, string> = {
  communication: 'Communication',
  agenda: 'Agenda',
  folders: 'Folders',
  workstreams: 'Flows',
  agents: 'Agents',
  team: 'Workforce',
  settings: 'Settings',
}

const TAB_SUBTITLES: Record<Tab, string> = {
  communication: 'Today, chats, customer and agent threads',
  agenda: 'Planned and past trigger occurrences',
  folders: 'A tag with a place: conversations, boards and documents under one path',
  workstreams: 'Stages for one kind of ticket',
  agents: 'AI teammates, their knowledge and what they may do',
  team: 'People, agents, departments and the Grid',
  settings: 'Workspace settings',
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

/** Resolve the active tab from a pathname (longest-prefix match). */
export function tabFromPath(pathname: string): Tab | null {
  if (pathname === '/new' || pathname.startsWith('/new/') || pathname.startsWith('/communication/new')) return null
  if (
    pathname === '/' ||
    pathname.startsWith('/communication') ||
    pathname.startsWith('/inbox') ||
    pathname.startsWith('/contacts') ||
    pathname.startsWith('/cockpit') ||
    pathname.startsWith('/overview') ||
    pathname === '/home'
  )
    return 'communication'
  if (pathname.startsWith('/agenda')) return 'agenda'
  if (pathname.startsWith('/workforce') || pathname.startsWith('/team')) return 'team'
  if (
    pathname.startsWith('/agents') ||
    pathname.startsWith('/knowledge') ||
    pathname.startsWith('/workspace') ||
    pathname.startsWith('/skills')
  )
    return 'agents'
  if (pathname.startsWith('/flows')) return 'workstreams'
  if (pathname.startsWith('/folders') || pathname.startsWith('/projects')) return 'folders'
  if (pathname === '/connections') return 'settings'
  // Installed module workspaces have no rail item.
  if (pathname.startsWith('/connections/') || pathname.startsWith('/ai/modules')) return null
  if (
    pathname.startsWith('/settings') ||
    pathname.startsWith('/usage') ||
    pathname.startsWith('/ai/') ||
    pathname.startsWith('/govern')
  )
    return 'settings'
  return null
}
