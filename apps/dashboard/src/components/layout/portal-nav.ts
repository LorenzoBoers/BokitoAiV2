import {
  MessageSquare,
  MessagesSquare,
  SlidersHorizontal,
  Users,
  type LucideIcon,
  Inbox,
  UserCog,
  Bell,
  Landmark,
  Building2,
  BookOpen,
  Building,
  Bot,
  Link2,
  KeyRound,
  Zap,
  Blocks,
  LayoutDashboard,
  FileText,
  ShieldCheck,
} from 'lucide-react'
import type { TFunction } from 'i18next'
import { ASSISTENT_DEFAULT_PATH } from '../../lib/assistent-settings-path'

/** Default landing for the Agents section. */
export const AGENTS_DEFAULT_PATH = '/agents' as const

export type MessagesHubOptions = {
  queue?: string
  projectId?: string
}

/** Canonical URL for the unified Messages hub (Signal threads). */
export function messagesHubPath(options: MessagesHubOptions = {}): string {
  const queue = options.queue ?? 'my'
  const params = new URLSearchParams()
  if (options.projectId) params.set('project_id', options.projectId)
  const query = params.toString()
  return `/messages/${queue}${query ? `?${query}` : ''}`
}

export type NavBadgeSlot = 'inbox' | 'agents' | 'home' | 'messages'

export type RailItem = {
  label: string
  to: string
  icon: LucideIcon
  comingSoon?: boolean
  badgeSlot?: NavBadgeSlot
}

export type SidebarLink = {
  label: string
  to: string
  comingSoon?: boolean
  /** Optional NavCountBadge slot rendered on the right of the link. */
  badgeSlot?: NavBadgeSlot
  /** When true, link is considered active only on an exact pathname match. */
  exact?: boolean
}

export type SidebarGroup = {
  label: string
  links: SidebarLink[]
}

/**
 * Consolidated portal navigation: Home, Messages, Agents, Workspace,
 * Automations, Integrations, Govern, Settings.
 */
export const getRailItems = (t: TFunction<'nav'>): RailItem[] => [
  { label: t('rail.home', { defaultValue: 'Home' }), to: '/home', icon: LayoutDashboard, badgeSlot: 'home' },
  {
    label: t('rail.support', { defaultValue: 'Messages' }),
    to: '/messages',
    icon: MessageSquare,
    badgeSlot: 'inbox',
  },
  { label: t('rail.agents', { defaultValue: 'Agents' }), to: AGENTS_DEFAULT_PATH, icon: Bot, badgeSlot: 'agents' },
  { label: t('rail.workspace', { defaultValue: 'Workspace' }), to: '/workspace', icon: FileText },
  { label: t('rail.automations', { defaultValue: 'Automations' }), to: '/automations', icon: Zap },
  { label: t('rail.integrations'), to: '/integrations/connected', icon: Link2 },
  { label: t('rail.govern', { defaultValue: 'Govern' }), to: '/govern', icon: ShieldCheck },
  { label: t('rail.settings'), to: '/settings/profile', icon: SlidersHorizontal },
]

/** Agents section sidebar: library plus platform agent settings. */
export const getAgentsSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('aiOs.group.nav', { defaultValue: 'Agents' }),
    links: [
      {
        label: t('aiOs.links.agents', { defaultValue: 'Agent library' }),
        to: AGENTS_DEFAULT_PATH,
        badgeSlot: 'agents',
      },
    ],
  },
  {
    label: t('workforce.group.platform', { defaultValue: 'Platform agents' }),
    links: [
      { label: t('workforce.links.assistant', { defaultValue: 'Assistant agent' }), to: ASSISTENT_DEFAULT_PATH },
      {
        label: t('workforce.links.communication', { defaultValue: 'Communication agent' }),
        to: '/ai/communicatie',
      },
    ],
  },
]

export const getIntegrationsSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('integrations.group.nav'),
    links: [
      { label: t('integrations.links.connected'), to: '/integrations/connected' },
      { label: t('integrations.links.marketplace'), to: '/integrations/marketplace' },
      { label: t('integrations.links.mcp'), to: '/integrations/mcp' },
      { label: t('integrations.links.docs'), to: '/integrations/docs' },
      { label: t('integrations.links.api'), to: '/integrations/api' },
    ],
  },
]

export const getSettingsSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('settings.groups.personal'),
    links: [
      { label: t('settings.links.profile'), to: '/settings/profile' },
      { label: t('settings.links.notifications'), to: '/settings/notifications' },
    ],
  },
  {
    label: t('settings.groups.workspace'),
    links: [
      { label: t('settings.links.general'), to: '/settings/general' },
      { label: t('settings.links.branding'), to: '/settings/branding' },
      { label: t('settings.links.membersTeams'), to: '/settings/members' },
      { label: t('settings.links.inbox', { defaultValue: 'Messages and channels' }), to: '/settings/inbox' },
      { label: t('settings.links.accessSecurity'), to: '/settings/access-security' },
    ],
  },
]

export const getSettingsPageMeta = (
  t: TFunction<'nav'>,
): Record<string, { title: string; description: string; icon: LucideIcon }> => ({
  profile: {
    title: t('settingsPageMeta.profile.title'),
    description: t('settingsPageMeta.profile.description'),
    icon: UserCog,
  },
  notifications: {
    title: t('settingsPageMeta.notifications.title'),
    description: t('settingsPageMeta.notifications.description'),
    icon: Bell,
  },
  support: {
    title: t('settingsPageMeta.support.title'),
    description: t('settingsPageMeta.support.description'),
    icon: MessageSquare,
  },
  messenger: {
    title: t('settingsPageMeta.messenger.title'),
    description: t('settingsPageMeta.messenger.description'),
    icon: MessageSquare,
  },
  'help-centers': {
    title: t('settingsPageMeta.helpCenters.title'),
    description: t('settingsPageMeta.helpCenters.description'),
    icon: BookOpen,
  },
  general: {
    title: t('settingsPageMeta.general.title'),
    description: t('settingsPageMeta.general.description'),
    icon: Building2,
  },
  branding: {
    title: t('settingsPageMeta.branding.title'),
    description: t('settingsPageMeta.branding.description'),
    icon: Building2,
  },
  members: {
    title: t('settingsPageMeta.members.title'),
    description: t('settingsPageMeta.members.description'),
    icon: Users,
  },
  teams: {
    title: t('settingsPageMeta.teams.title'),
    description: t('settingsPageMeta.teams.description'),
    icon: Users,
  },
  billing: {
    title: t('settingsPageMeta.billing.title'),
    description: t('settingsPageMeta.billing.description'),
    icon: Landmark,
  },
  'access-security': {
    title: t('settingsPageMeta.accessSecurity.title'),
    description: t('settingsPageMeta.accessSecurity.description'),
    icon: UserCog,
  },
  company: {
    title: t('settingsPageMeta.company.title'),
    description: t('settingsPageMeta.company.description'),
    icon: Building,
  },
  inbox: {
    title: t('settingsPageMeta.inbox.title'),
    description: t('settingsPageMeta.inbox.description'),
    icon: Inbox,
  },
  conversations: {
    title: t('settingsPageMeta.conversations.title'),
    description: t('settingsPageMeta.conversations.description'),
    icon: MessagesSquare,
  },
})

export const getIntegrationsPageMeta = (
  t: TFunction<'nav'>,
): Record<string, { title: string; description: string; icon: LucideIcon }> => ({
  connected: {
    title: t('integrations.pageMeta.connected.title'),
    description: t('integrations.pageMeta.connected.description'),
    icon: Link2,
  },
  marketplace: {
    title: t('integrations.pageMeta.marketplace.title'),
    description: t('integrations.pageMeta.marketplace.description'),
    icon: Blocks,
  },
  mcp: {
    title: t('integrations.pageMeta.mcp.title'),
    description: t('integrations.pageMeta.mcp.description'),
    icon: Zap,
  },
  docs: {
    title: t('integrations.pageMeta.docs.title'),
    description: t('integrations.pageMeta.docs.description'),
    icon: BookOpen,
  },
  api: {
    title: t('integrations.pageMeta.api.title'),
    description: t('integrations.pageMeta.api.description'),
    icon: KeyRound,
  },
})

export const getAiPageMeta = (
  t: TFunction<'nav'>,
): Record<string, { title: string; description: string; icon: LucideIcon }> => ({
  assistent: {
    title: t('settingsPageMeta.messenger.title'),
    description: t('settingsPageMeta.messenger.description'),
    icon: MessageSquare,
  },
  communicatie: {
    title: t('ai.pageMeta.communication.title'),
    description: t('ai.pageMeta.communication.description'),
    icon: MessageSquare,
  },
  agents: {
    title: t('workforce.pageMeta.agents.title', { defaultValue: 'Your agents' }),
    description: t('workforce.pageMeta.agents.description', {
      defaultValue: 'Configured workforce agents for this workspace.',
    }),
    icon: Bot,
  },
})

export const getSupportPageMeta = (
  t: TFunction<'nav'>,
): Record<string, { title: string; description: string; icon: LucideIcon }> => ({
  my: { title: t('supportPageMeta.my.title'), description: t('supportPageMeta.my.description'), icon: Inbox },
  all: { title: t('supportPageMeta.all.title'), description: t('supportPageMeta.all.description'), icon: Inbox },
  created: {
    title: t('supportPageMeta.created.title'),
    description: t('supportPageMeta.created.description'),
    icon: Inbox,
  },
  unassigned: {
    title: t('supportPageMeta.unassigned.title'),
    description: t('supportPageMeta.unassigned.description'),
    icon: Inbox,
  },
})
