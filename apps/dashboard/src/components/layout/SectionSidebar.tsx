import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { UserAvatar } from '../ui/UserAvatar'
import {
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  Building,
  CreditCard,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  Mail,
  MessageSquare,
  Shield,
  UserCircle2,
  Users,
  Zap,
  Blocks,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  getAgentsSidebarGroups,
  getIntegrationsSidebarGroups,
  getSettingsSidebarGroups,
  type SidebarGroup,
  type SidebarLink,
} from './portal-nav'
import InboxSidebarNav from '../inbox/InboxSidebarNav'
import NavCountBadge from './NavCountBadge'
import { ASSISTENT_DEFAULT_PATH } from '../../lib/assistent-settings-path'
import { useNavBadges } from '../../context/NavBadgeContext'
import { countForBadgeSlot } from '../../lib/nav-badge-counts'

function sectionClass(isActive: boolean) {
  return `flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all ${
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary'
  }`
}

function iconForLink(to: string) {
  if (to.includes('/messages')) return Inbox
  if (to.includes('/settings/profile')) return UserCircle2
  if (to.includes('/settings/notifications')) return Bell
  if (to.includes('/settings/help-centers')) return BookOpen
  if (to.includes('/settings/general')) return Briefcase
  if (to.includes('/settings/branding')) return Building
  if (to.includes('/settings/members')) return Users
  if (to.includes('/settings/billing')) return CreditCard
  if (to.includes('/settings/access-security')) return Shield
  if (to.includes('/settings/inbox')) return Inbox
  if (to.includes('/ai/assistent')) return MessageSquare
  if (to.includes('/ai/communicatie')) return MessageSquare
  if (to.includes('/integrations/connected')) return Link2
  if (to.includes('/integrations/marketplace')) return Blocks
  if (to.includes('/integrations/mcp')) return Zap
  if (to.includes('/integrations/api')) return KeyRound
  if (to.includes('/integrations/docs')) return BookOpen
  if (to.startsWith('/agents')) return Bot
  if (to.startsWith('/workspace')) return BookOpen
  return LayoutDashboard
}

function SidebarGroupBlock({
  group,
  user,
  pathname,
}: {
  group: SidebarGroup
  user: { name: string; email: string; avatarUrl?: string | null } | null
  pathname: string
}) {
  const { counts } = useNavBadges()
  return (
    <section className="space-y-1">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{group.label}</p>
      <div className="space-y-0.5">
        {group.links.map((item: SidebarLink) => {
          const badgeCount = item.badgeSlot ? countForBadgeSlot(counts, item.badgeSlot) : 0
          const exact = item.exact === true
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={exact}
              className={({ isActive }) =>
                sectionClass(
                  isActive ||
                    (item.to === ASSISTENT_DEFAULT_PATH && pathname.startsWith('/ai/assistent/')),
                )
              }
            >
              {item.to === '/support/inbox/my' ? (
                <UserAvatar name={user?.name ?? '?'} email={user?.email ?? ''} avatarUrl={user?.avatarUrl} size={20} />
              ) : (
                (() => {
                  const Icon = iconForLink(item.to)
                  return <Icon size={14} className="text-text-muted" />
                })()
              )}
              <span className="min-w-0 truncate">{item.label}</span>
              {badgeCount > 0 ? (
                <NavCountBadge count={badgeCount} placement="inline" className="ml-auto" />
              ) : null}
            </NavLink>
          )
        })}
      </div>
    </section>
  )
}

function resolveGroups(pathname: string, t: TFunction<'nav'>): SidebarGroup[] {
  if (pathname.startsWith('/agents') || pathname.startsWith('/ai/')) return getAgentsSidebarGroups(t)
  if (pathname.startsWith('/integrations')) return getIntegrationsSidebarGroups(t)
  if (pathname.startsWith('/settings')) return getSettingsSidebarGroups(t)
  return []
}

function resolveTitle(pathname: string, t: TFunction<['nav']>): string {
  if (pathname.startsWith('/agents') || pathname.startsWith('/ai/')) {
    return t('nav:sectionTitle.agents', { defaultValue: 'Agents' })
  }
  if (pathname.startsWith('/workspace')) return t('nav:sectionTitle.workspace', { defaultValue: 'Workspace' })
  if (pathname.startsWith('/integrations')) return t('nav:sectionTitle.integrations')
  if (pathname.startsWith('/settings')) return t('nav:sectionTitle.settings')
  if (pathname.startsWith('/messages')) {
    return t('nav:sectionTitle.inbox', { defaultValue: 'Messages' })
  }
  return t('nav:sectionTitle.home', { defaultValue: 'Home' })
}

export default function SectionSidebar() {
  const { t } = useTranslation(['nav'])
  const { user } = useAuth()
  const { pathname } = useLocation()

  // Full-bleed surfaces render without the section sidebar.
  if (
    pathname === '/home' ||
    pathname.startsWith('/home/') ||
    pathname === '/govern' ||
    pathname.startsWith('/govern/') ||
    pathname === '/automations' ||
    pathname.startsWith('/automations/') ||
    pathname.startsWith('/workspace')
  ) {
    return null
  }

  const groups = resolveGroups(pathname, t as TFunction<'nav'>)
  const title = resolveTitle(pathname, t)

  const isInbox = pathname.startsWith('/messages')

  if (!isInbox && groups.length === 0) {
    return null
  }

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border/55 bg-bg-sidebar px-3 py-3">
      <h2 className="px-3 pb-3 text-[22px] font-semibold leading-none text-text-heading">{title}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isInbox ? (
          <InboxSidebarNav />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <SidebarGroupBlock key={group.label} group={group} user={user ?? null} pathname={pathname} />
            ))}
          </div>
        )}
      </div>
      {isInbox && (
        <div className="mt-2 space-y-0.5 border-t border-border/40 pt-2">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('nav:inbox.configureGroup', { defaultValue: 'Configure' })}
          </p>
          <NavLink
            to={ASSISTENT_DEFAULT_PATH}
            className={({ isActive }) =>
              sectionClass(isActive || pathname.startsWith('/ai/assistent/'))
            }
          >
            <MessageSquare size={14} className="text-text-muted" />
            <span>{t('nav:inbox.configureAssistent', { defaultValue: 'Assistent settings' })}</span>
          </NavLink>
          <NavLink to="/settings/inbox" className={({ isActive }) => sectionClass(isActive)}>
            <Mail size={14} className="text-text-muted" />
            <span>{t('nav:inbox.configureInbox', { defaultValue: 'Messages settings' })}</span>
          </NavLink>
        </div>
      )}
    </aside>
  )
}
