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
  Sparkles,
  Building,
  Bot,
  Upload,
} from 'lucide-react'
import type { TFunction } from 'i18next'

export type RailItem = {
  label: string
  to: string
  icon: LucideIcon
  comingSoon?: boolean
}

export type SidebarLink = {
  label: string
  to: string
  comingSoon?: boolean
}

export type SidebarGroup = {
  label: string
  links: SidebarLink[]
}

export const getRailItems = (t: TFunction<'nav'>): RailItem[] => [
  { label: t('rail.support'), to: '/support/inbox/all', icon: MessageSquare },
  { label: t('rail.help'), to: '/docs', icon: BookOpen },
  { label: t('rail.updates'), to: '/projects', icon: Sparkles },
  { label: t('rail.data'), to: '/database', icon: Database },
  { label: t('rail.workforce'), to: '/workforce', icon: Bot, comingSoon: true },
  { label: t('rail.settings'), to: '/settings/profile', icon: SlidersHorizontal },
]

export const getSupportSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('support.group.inbox'),
    links: [
      { label: t('support.links.myInbox'), to: '/support/inbox/my' },
      { label: t('support.links.allMessages'), to: '/support/inbox/all' },
      { label: t('support.links.createdByMe'), to: '/support/inbox/created' },
      { label: t('support.links.unassigned'), to: '/support/inbox/unassigned' },
    ],
  },
]

export const getUserSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('users.group.customerData'),
    links: [
      { label: t('users.links.attributes'), to: '/users/attributes' },
      { label: t('users.links.tags'), to: '/users/tags' },
      { label: t('users.links.segments'), to: '/users/segments' },
      { label: t('users.links.leadQualification'), to: '/users/lead-qualification' },
      { label: t('users.links.blocked'), to: '/users/blocked' },
    ],
  },
]

export const getAiSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('ai.group.ai'),
    links: [
      { label: t('ai.links.assistent'), to: '/ai/assistent' },
      { label: t('ai.links.kennis'), to: '/projects' },
      { label: t('ai.links.datasources'), to: '/datasources' },
      { label: t('ai.links.handelingen'), to: '/ai/handelingen', comingSoon: true },
    ],
  },
]

export const getWorkforceSidebarGroups = (t: TFunction<'nav'>): SidebarGroup[] => [
  {
    label: t('workforce.group.workforce'),
    links: [
      { label: t('workforce.links.overview'), to: '/workforce', comingSoon: true },
      { label: t('workforce.links.agents'), to: '/workforce/agents', comingSoon: true },
      { label: t('workforce.links.tasks'), to: '/workforce/tasks', comingSoon: true },
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
    label: t('settings.groups.products'),
    links: [
      { label: t('settings.links.inbox'), to: '/settings/inbox' },
      { label: t('settings.links.messenger'), to: '/ai/assistent' },
      { label: t('settings.links.helpCenters'), to: '/settings/help-centers', comingSoon: true },
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
  {
    label: t('settings.groups.data'),
    links: [
      { label: t('settings.links.users'), to: '/settings/data/users' },
      { label: t('settings.links.companies'), to: '/settings/data/companies' },
      { label: t('settings.links.conversations'), to: '/settings/data/conversations' },
      { label: t('settings.links.importsExports'), to: '/settings/data/imports-exports' },
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
