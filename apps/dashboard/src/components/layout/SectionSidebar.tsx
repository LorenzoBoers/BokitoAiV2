import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { UserAvatar } from '../ui/UserAvatar'
import {
  Bell,
  BookOpen,
  Briefcase,
  Building,
  CreditCard,
  Database,
  FolderKanban,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  Mail,
  MessageSquare,
  PenLine,
  Shield,
  Sparkles,
  Tag,
  UserCircle2,
  Users,
  Zap,
  Blocks,
  Bot,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  getAiSidebarGroups,
  getDataSidebarGroups,
  getIntegrationsSidebarGroups,
  getProjectHubSidebarGroups,
  getSettingsSidebarGroups,
  type SidebarGroup,
  type SidebarLink,
} from './portal-nav'
import DatabaseTablesPanel from './DatabaseTablesPanel'
import InboxSidebarNav from '../inbox/InboxSidebarNav'
import NavCountBadge from './NavCountBadge'
import { ASSISTENT_DEFAULT_PATH } from '../../lib/assistent-settings-path'
import { useOptionalProjectDocNav } from '../../context/ProjectDocNavContext'
import { useOptionalWorkspaceDocNav } from '../../context/WorkspaceDocNavContext'
import { useNavBadges } from '../../context/NavBadgeContext'
import { countForBadgeSlot } from '../../lib/nav-badge-counts'
import { PageTree } from '../doc/PageTree'
import ProjectHubBackgroundWorkersNav from './ProjectHubBackgroundWorkersNav'
import { isProjectHubRoute } from '../../context/ProjectHubNavContext'

function sectionClass(isActive: boolean) {
  return `flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all ${
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary'
  }`
}

function iconForLink(to: string) {
  if (to.includes('/support/inbox')) return Inbox
  if (to.includes('/support/customization')) return Sparkles
  if (to.includes('/support/settings')) return Mail
  if (to.includes('/users/attributes')) return UserCircle2
  if (to.includes('/users/tags')) return Tag
  if (to.includes('/users/segments')) return Database
  if (to.includes('/users/lead-qualification')) return Shield
  if (to.includes('/users/blocked')) return KeyRound
  if (to.includes('/settings/profile')) return UserCircle2
  if (to.includes('/settings/notifications')) return Bell
  if (to.includes('/settings/support')) return Mail
  if (to.includes('/settings/messenger')) return MessageSquare
  if (to.includes('/settings/help-centers')) return BookOpen
  if (to.includes('/settings/general')) return Briefcase
  if (to.includes('/settings/branding')) return Building
  if (to.includes('/settings/members')) return Users
  if (to.includes('/settings/billing')) return CreditCard
  if (to.includes('/settings/access-security')) return Shield
  if (to.includes('/settings/inbox')) return Inbox
  if (to.includes('/settings/data/users')) return Users
  if (to.includes('/settings/data/companies')) return Building
  if (to.includes('/settings/data/conversations')) return MessageSquare
  if (to.includes('/settings/data/imports-exports')) return Database
  if (to === '/projects') return LayoutDashboard
  if (to === '/projects/docs' || to.startsWith('/projects/docs/')) return BookOpen
  if (to === '/projects/list') return FolderKanban
  if (to === '/projects/communication') return MessageSquare
  if (to === '/projects/new' || to.startsWith('/projects/new/')) return FolderKanban
  if (to.startsWith('/projects')) return FolderKanban
  if (to.includes('/ai/assistent')) return MessageSquare
  if (to.includes('/ai/communicatie')) return MessageSquare
  if (to.includes('/ai/handelingen')) return Zap
  if (to.includes('/data/sources') || to.includes('/integrations/sources')) return BookOpen
  if (to.includes('/data/imports-exports')) return Database
  if (to.includes('/integrations/connected')) return Link2
  if (to.includes('/integrations/connections')) return Link2
  if (to.includes('/integrations/marketplace')) return Blocks
  if (to.includes('/integrations/mcp')) return Zap
  if (to.includes('/integrations/api')) return KeyRound
  if (to === '/ai/agents' || to.startsWith('/ai/agents/')) return Bot
  if (to.includes('/project/') && to.endsWith('/overview')) return Briefcase
  if (/\/project\/[^/]+\/(pkb|doc)/.test(to)) return BookOpen
  if (to.includes('/project/') && to.endsWith('/orchestration')) return Sparkles
  if (to.includes('/project/') && to.endsWith('/notifications')) return Bell
  if (to.includes('/project/') && to.endsWith('/workforce')) return Users
  if (to.includes('/project/') && to.endsWith('/usage')) return Database
  if (to.includes('/project/') && to.endsWith('/communication')) return MessageSquare
  if (to.includes('/project/') && to.endsWith('/request')) return PenLine
  if (to.includes('/project/') && to.endsWith('/messages')) return MessageSquare
  if (to.includes('/project/') && to.endsWith('/settings')) return Shield
  return Inbox
}

function isLinkActive(to: string, pathname: string, exact?: boolean): boolean {
  if (exact) return pathname === to
  // Doc link should remain active for any /doc or /doc/:slug nested route.
  const docMatch = to.match(/^(\/project\/[^/]+\/doc)$/)
  if (docMatch) {
    return pathname === docMatch[1] || pathname.startsWith(`${docMatch[1]}/`)
  }
  // Workspace docs link stays active for child page slugs.
  if (to === '/projects/docs') {
    return pathname === '/projects/docs' || pathname.startsWith('/projects/docs/')
  }
  if (to === '/ai/agents') {
    return pathname === '/ai/agents' || pathname.startsWith('/ai/agents/')
  }
  return pathname === to
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
          if (item.comingSoon) {
            return (
              <div key={item.to} className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-1.5 text-[13px] font-medium opacity-40 cursor-not-allowed select-none">
                {(() => {
                  const Icon = iconForLink(item.to)
                  return <Icon size={14} className="text-text-muted shrink-0" />
                })()}
                <span>{item.label}</span>
                <span className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-bg-hover text-text-muted">binnenkort</span>
              </div>
            )
          }
          const badgeCount = item.badgeSlot ? countForBadgeSlot(counts, item.badgeSlot) : 0
          const exact = item.exact === true
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={exact}
              className={({ isActive }) =>
                sectionClass(
                  (isActive && (!exact || pathname === item.to)) ||
                    isLinkActive(item.to, pathname, exact) ||
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
                <NavCountBadge
                  count={badgeCount}
                  placement="inline"
                  className="ml-auto"
                />
              ) : null}
            </NavLink>
          )
        })}
      </div>
    </section>
  )
}

function ProjectDocPagesGroup({
  pathname,
  projectId,
}: {
  pathname: string
  projectId: string
}) {
  const { t } = useTranslation('nav')
  const docNav = useOptionalProjectDocNav()
  const slug = pathname.match(/^\/project\/[^/]+\/doc\/([^/]+)/)?.[1] ?? null
  const activePageId = slug && docNav?.pages
    ? docNav.pages.find((p) => p.slug === slug)?.id
    : undefined

  return (
    <section className="space-y-1">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {t('project.group.pages', { defaultValue: 'Pages' })}
      </p>
      {docNav?.loading ? (
        <p className="px-3 py-1 text-xs text-text-muted">
          {t('project.doc.loading', { defaultValue: 'Loading documentation…' })}
        </p>
      ) : docNav?.error ? (
        <p className="px-3 py-1 text-xs text-text-muted">
          {t('project.doc.loadErrorDeploy', {
            defaultValue: 'Documentation backend not available yet.',
          })}
        </p>
      ) : docNav && docNav.pages.length > 0 ? (
        <PageTree
          pages={docNav.pages}
          projectId={projectId}
          activePageId={activePageId}
          variant="sidebar"
          enablePageCrud
          onPagesChanged={() => docNav?.refresh()}
        />
      ) : (
        <p className="px-3 py-1 text-xs text-text-muted">
          {t('project.doc.treeEmpty', { defaultValue: 'No pages yet.' })}
        </p>
      )}
    </section>
  )
}

function resolveGroups(pathname: string, t: TFunction<'nav'>): SidebarGroup[] {
  if (pathname === '/home' || pathname.startsWith('/home/')) return []
  // Wizard routes have their own full-bleed layout — no sidebar groups.
  if (pathname === '/projects/new' || pathname.startsWith('/projects/new/')) return []
  if (isProjectHubRoute(pathname)) return getProjectHubSidebarGroups(t)
  if (pathname.startsWith('/integrations')) return getIntegrationsSidebarGroups(t)
  if (pathname.startsWith('/settings')) return getSettingsSidebarGroups(t)
  if (
    pathname.startsWith('/users') ||
    pathname.startsWith('/database') ||
    pathname.startsWith('/data/')
  ) {
    return getDataSidebarGroups(t)
  }
  if (pathname.startsWith('/ai')) return getAiSidebarGroups(t)
  if (pathname.startsWith('/workforce')) return getAiSidebarGroups(t)
  return []
}

function resolveTitle(pathname: string, t: TFunction<['nav']>): string {
  if (pathname === '/home' || pathname.startsWith('/home/')) return t('nav:sectionTitle.home', { defaultValue: 'Home' })
  if (isProjectHubRoute(pathname)) return t('nav:sectionTitle.projectHub', { defaultValue: 'Project hub' })
  if (pathname.startsWith('/users') || pathname.startsWith('/database') || pathname.startsWith('/data/')) {
    return t('nav:sectionTitle.data')
  }
  if (pathname.startsWith('/integrations')) return t('nav:sectionTitle.integrations')
  if (pathname.startsWith('/settings')) return t('nav:sectionTitle.settings')
  if (pathname.startsWith('/ai')) return t('nav:sectionTitle.assistent', { defaultValue: 'Assistent' })
  if (pathname.startsWith('/workforce')) {
    return t('nav:sectionTitle.assistent', { defaultValue: 'Assistent' })
  }
  return t('nav:sectionTitle.inbox')
}

export default function SectionSidebar() {
  const { t } = useTranslation(['nav'])
  const { user } = useAuth()
  const { pathname } = useLocation()

  if (pathname === '/home' || pathname.startsWith('/home/')) {
    return null
  }

  // The new-project wizard owns its full-bleed canvas; suppress the sidebar.
  if (pathname === '/projects/new' || pathname.startsWith('/projects/new/')) {
    return null
  }

  const onProjectHub = isProjectHubRoute(pathname)
  const groups = resolveGroups(pathname, t as TFunction<'nav'>)
  const title = resolveTitle(pathname, t)

  const isInbox = pathname.startsWith('/support') || pathname.startsWith('/communication')
  const isDatabaseRoute = pathname.startsWith('/database')
  const projectMatch = pathname.match(/^\/project\/([^/]+)/)
  const projectId = projectMatch?.[1] ?? null
  const onDocRoute = Boolean(projectId && /\/project\/[^/]+\/doc/.test(pathname))

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
            {onProjectHub ? <ProjectHubBackgroundWorkersNav /> : null}
            {onDocRoute && projectId ? (
              <ProjectDocPagesGroup pathname={pathname} projectId={projectId} />
            ) : null}
            {isDatabaseRoute ? <DatabaseTablesPanel /> : null}
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
            <span>{t('nav:inbox.configureInbox', { defaultValue: 'Inbox settings' })}</span>
          </NavLink>
        </div>
      )}
    </aside>
  )
}
