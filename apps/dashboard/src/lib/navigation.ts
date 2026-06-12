/**
 * Navigation model for the OpenClaw-style control shell.
 *
 * Mirrors OpenClaw's `navigation.ts`: tabs live in labeled sidebar groups,
 * each tab maps to a route path, an icon, a title and a subtitle. The Inbox
 * hub (assistant chat + customers + agents) is the default surface.
 */

import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  Contact,
  MessageSquare,
  Settings,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export type Tab =
  | 'overview'
  | 'communication'
  | 'contacts'
  | 'activity'
  | 'agenda'
  | 'usage'
  | 'agents'
  | 'skills'
  | 'memory'
  | 'settings'

export const TAB_GROUPS: ReadonlyArray<{ label: string; tabs: readonly Tab[] }> = [
  { label: 'Control', tabs: ['overview', 'communication', 'contacts', 'activity', 'agenda', 'usage'] },
  { label: 'Agent', tabs: ['agents', 'skills', 'memory'] },
  { label: 'Settings', tabs: ['settings'] },
]

export const TAB_PATHS: Record<Tab, string> = {
  overview: '/overview',
  communication: '/communication/inbox/all',
  contacts: '/contacts',
  activity: '/activity',
  agenda: '/agenda',
  usage: '/usage',
  agents: '/agents',
  skills: '/skills',
  memory: '/workspace',
  settings: '/settings',
}

const TAB_ICONS: Record<Tab, LucideIcon> = {
  overview: BarChart3,
  communication: MessageSquare,
  contacts: Contact,
  activity: Activity,
  agenda: CalendarDays,
  usage: BarChart3,
  agents: Bot,
  skills: Zap,
  memory: BookOpen,
  settings: Settings,
}

const TAB_TITLES: Record<Tab, string> = {
  overview: 'Overview',
  communication: 'Communication',
  contacts: 'Contacts',
  activity: 'Activity',
  agenda: 'Agenda',
  usage: 'Usage',
  agents: 'Agents',
  skills: 'Skills',
  memory: 'Memory',
  settings: 'Settings',
}

const TAB_SUBTITLES: Record<Tab, string> = {
  overview: 'Workspace health at a glance',
  communication: 'Chats, customer and agent threads',
  contacts: 'People across your channels',
  activity: 'Live agent runs and tool calls',
  agenda: 'Scheduled wakes, tasks and events',
  usage: 'Model spend and run volume',
  agents: 'Your agent workforce',
  skills: 'Reusable instructions for agents',
  memory: 'Workspace documents and memory',
  settings: 'Workspace configuration',
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
  if (pathname === '/' || pathname.startsWith('/communication') || pathname.startsWith('/inbox'))
    return 'communication'
  if (pathname.startsWith('/overview')) return 'overview'
  if (pathname.startsWith('/contacts')) return 'contacts'
  if (pathname.startsWith('/activity')) return 'activity'
  if (pathname.startsWith('/agenda')) return 'agenda'
  if (pathname.startsWith('/usage')) return 'usage'
  if (pathname.startsWith('/agents')) return 'agents'
  if (pathname.startsWith('/skills')) return 'skills'
  if (pathname.startsWith('/workspace')) return 'memory'
  if (pathname.startsWith('/settings') || pathname.startsWith('/ai/')) return 'settings'
  return null
}
