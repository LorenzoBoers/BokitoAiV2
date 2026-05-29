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
  Database,
  BookOpen,
  Building,
  Bot,
  Upload,
  FileText,
  PenLine,
  FolderKanban,
  Link2,
  KeyRound,
  Zap,
  Blocks,
  LayoutDashboard,
} from 'lucide-react'
import type { TFunction } from 'i18next'
import { ASSISTENT_DEFAULT_PATH } from '../../lib/assistent-settings-path'

/** Default landing for the merged Workforce rail item. */
export const WORKFORCE_DEFAULT_PATH = '/workforce/agents' as const

export const WORKFORCE_PO_PATH = '/workforce/po' as const

export type NavBadgeSlot =
  | 'inbox'
  | 'agents'
  | 'home'
  | 'messages'
  /** Project hub rail badge: items awaiting admin action across projects. */
  | 'projectsAttention'

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
  /**
   * When true, link is considered active only on an exact pathname match.
   * Used for parent paths whose children belong to sibling sidebar links
   * (e.g. `/projects` vs `/projects/docs`).
   */
  exact?: boolean
}

export type SidebarGroup = {
  label: string
  links: SidebarLink[]
}

/** End-user navigation: PKB, change request, messages, settings only (Phase 3.1).
 * When no project is active in the URL, the Project link falls back to the
 * project list (/projects) and the Change Request link is hidden.
 */
export const getEndUserRailItems = (t: TFunction<'nav'>, projectId?: string): RailItem[] => {
  const projectTo = projectId ? `/project/${projectId}/overview` : '/home'
  const items: RailItem[] = [
    { label: t('rail.home', { defaultValue: 'Home' }), to: '/home', icon: LayoutDashboard, badgeSlot: 'home' },
    { label: t('rail.pkb', { defaultValue: 'Project' }), to: projectTo, icon: FileText },
  ]
  if (projectId) {
    items.push({
      label: t('rail.changeRequest', { defaultValue: 'Request' }),
      to: `/project/${projectId}/request`,
      icon: PenLine,
    })
  }
  items.push(
    {
      label: t('rail.messages', { defaultValue: 'Messages' }),
      to: '/messages',
      icon: MessagesSquare,
      badgeSlot: 'inbox',
    },
    { label: t('rail.settings'), to: '/settings/profile', icon: SlidersHorizontal },
  )
  return items
}

/** Admin / staff navigation (full portal surfaces). */
export const getAdminRailItems = (t: TFunction<'nav'>): RailItem[] => [
  { label: t('rail.home', { defaultValue: 'Home' }), to: '/home', icon: LayoutDashboard, badgeSlot: 'home' },
  {
    label: t('rail.projects', { defaultValue: 'Projects' }),
    to: '/projects',
    icon: FolderKanban,
    badgeSlot: 'projectsAttention',
  },
  { label: t('rail.support'), to: '/support/inbox/all', icon: MessageSquare, badgeSlot: 'inbox' },
  {
    label: t('rail.workforce', { defaultValue: 'Workforce' }),
    to: WORKFORCE_DEFAULT_PATH,
    icon: Bot,
    badgeSlot: 'agents',
  },
  { label: t('rail.integrations'), to: '/integrations/connected', icon: Link2 },
  { label: t('rail.data'), to: '/database', icon: Database, comingSoon: true },
  { label: t('rail.settings'), to: '/settings/profile', icon: SlidersHorizontal },
]

export const getRailItems = (t: TFunction<'nav'>, isAdmin = true, projectId?: string): RailItem[] =>
  isAdmin ? getAdminRailItems(t) : getEndUserRailItems(t, projectId)

export const getDataSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('data.group.nav', { defaultValue: 'Data' }),
    links: [
      { label: t('data.links.tables', { defaultValue: 'Tables' }), to: '/database' },
      { label: t('users.links.attributes'), to: '/users/attributes' },
      { label: t('users.links.tags'), to: '/users/tags' },
      { label: t('users.links.segments'), to: '/users/segments' },
      { label: t('users.links.leadQualification'), to: '/users/lead-qualification' },
      { label: t('users.links.blocked'), to: '/users/blocked' },
      { label: t('data.links.sources', { defaultValue: 'Knowledge sources' }), to: '/data/sources' },
      { label: t('data.links.importsExports', { defaultValue: 'Import and export' }), to: '/data/imports-exports' },
    ],
  },
]

export const getWorkforceSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
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

/** @deprecated Use getWorkforceSidebarGroups. Kept for legacy imports. */
export const getAiSidebarGroups = getWorkforceSidebarGroups

/** @deprecated Use getWorkforceSidebarGroups. */
export const getAgentsSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('agents.group.nav', { defaultValue: 'Agents' }),
    links: [{ label: t('agents.links.runs', { defaultValue: 'Agent runs' }), to: WORKFORCE_DEFAULT_PATH }],
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

/** Project hub: workspace-level cockpit tabs rendered in the contextual sidebar. */
export const getProjectHubSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('projectHub.group.nav', { defaultValue: 'Project hub' }),
    links: [
      {
        label: t('projectHub.tabs.overview', { defaultValue: 'Overview' }),
        to: '/projects',
        exact: true,
      },
      {
        label: t('projectHub.tabs.communication', { defaultValue: 'Communication' }),
        to: '/projects/communication',
        badgeSlot: 'projectsAttention',
      },
      {
        label: t('projectHub.tabs.docs', { defaultValue: 'Blueprint' }),
        to: '/projects/docs',
      },
    ],
  },
]

/** Per-project cockpit tabs rendered in the main canvas (not the hub sidebar). */
export const getProjectTabLinks = (t: TFunction<'nav'>, projectId: string): SidebarLink[] => [
  { label: t('project.links.overview', { defaultValue: 'Overview' }), to: `/project/${projectId}/overview` },
  {
    label: t('project.links.orchestration', { defaultValue: 'Orchestration' }),
    to: `/project/${projectId}/orchestration`,
  },
  {
    label: t('project.links.communication', { defaultValue: 'Communication' }),
    to: `/project/${projectId}/communication`,
  },
  {
    label: t('project.links.workforce', { defaultValue: 'Workforce history' }),
    to: `/project/${projectId}/workforce`,
  },
  {
    label: t('project.links.usage', { defaultValue: 'Token usage' }),
    to: `/project/${projectId}/usage`,
  },
  {
    label: t('project.links.notifications', { defaultValue: 'Notifications' }),
    to: `/project/${projectId}/notifications`,
  },
  {
    label: t('project.links.request', { defaultValue: 'Request a change' }),
    to: `/project/${projectId}/request`,
  },
  {
    label: t('project.links.settings', { defaultValue: 'Settings' }),
    to: `/project/${projectId}/settings`,
  },
]

/** @deprecated Use getProjectTabLinks in the project canvas; hub sidebar uses background project list. */
export const getProjectSidebarGroups = (t: TFunction<'nav'>, projectId: string): SidebarGroup[] => [
  {
    label: t('project.group.nav', { defaultValue: 'Project' }),
    links: getProjectTabLinks(t, projectId),
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
      { label: t('settings.links.billing'), to: '/settings/billing' },
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
  attributes: {
    title: t('settingsPageMeta.attributes.title'),
    description: t('settingsPageMeta.attributes.description'),
    icon: Database,
  },
  users: {
    title: t('settingsPageMeta.users.title'),
    description: t('settingsPageMeta.users.description'),
    icon: Users,
  },
  companies: {
    title: t('settingsPageMeta.companies.title'),
    description: t('settingsPageMeta.companies.description'),
    icon: Building,
  },
  conversations: {
    title: t('settingsPageMeta.conversations.title'),
    description: t('settingsPageMeta.conversations.description'),
    icon: MessagesSquare,
  },
  'imports-exports': {
    title: t('settingsPageMeta.importsExports.title'),
    description: t('settingsPageMeta.importsExports.description'),
    icon: Upload,
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
  connections: {
    title: t('integrations.pageMeta.connected.title'),
    description: t('integrations.pageMeta.connected.description'),
    icon: Link2,
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
  sources: {
    title: t('integrations.pageMeta.sources.title'),
    description: t('integrations.pageMeta.sources.description'),
    icon: BookOpen,
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

export const getWorkforcePageMeta = (
  t: TFunction<'nav'>,
): Record<string, { title: string; description: string; icon: LucideIcon }> => ({
  agents: {
    title: t('workforce.pageMeta.agents.title', { defaultValue: 'Your agents' }),
    description: t('workforce.pageMeta.agents.description', {
      defaultValue: 'Configured workforce agents for this workspace.',
    }),
    icon: Bot,
  },
  po: {
    title: t('workforce.pageMeta.po.title', { defaultValue: 'PO agents' }),
    description: t('workforce.pageMeta.po.description', {
      defaultValue: 'Product-owner orchestrators across projects.',
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
