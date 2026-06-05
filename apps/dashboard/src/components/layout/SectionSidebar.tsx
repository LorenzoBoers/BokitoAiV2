import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { UserAvatar } from '../ui/UserAvatar'
import {
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  Building,
  CalendarDays,
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
  Plus,
  Shield,
  Sparkles,
  Settings,
  Tag,
  UserCircle2,
  Users,
  Zap,
  Blocks,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  getDataSidebarGroups,
  getIntegrationsSidebarGroups,
  getAiOsSidebarGroups,
  getSettingsSidebarGroups,
  type SidebarGroup,
  type SidebarLink,
} from './portal-nav'
import WorkforceSidebarNav from './WorkforceSidebarNav'
import { isAiOsRoute } from '../../lib/workforce-nav-agents'
import InboxSidebarNav from '../inbox/InboxSidebarNav'
import AgendaSidebar from '../agenda/AgendaSidebar'
import NavCountBadge from './NavCountBadge'
import { ASSISTENT_DEFAULT_PATH } from '../../lib/assistent-settings-path'
import { useNavBadges } from '../../context/NavBadgeContext'
import { isBokitoMode } from '../../lib/bokito-mode'
import { countForBadgeSlot } from '../../lib/nav-badge-counts'
import ProjectHubBackgroundWorkersNav from './ProjectHubBackgroundWorkersNav'
import { isProjectHubRoute, useOptionalProjectHubNav } from '../../context/ProjectHubNavContext'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Button } from '../ui/button'

const CREATE_PROJECT_VALUE = '__create__'

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
  if (to === '/os' || to === '/projects') return LayoutDashboard
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
  if (to.includes('/workforce/po') || to.includes('/workforce/agents') || to.includes('/workforce/overview')) return Bot
  if (to.includes('/admin/runs')) return Bot
  if (to === '/orchestra' || to.startsWith('/orchestra/')) return Sparkles
  if (to === '/agenda' || to.startsWith('/agenda/')) return CalendarDays
  if (to.includes('/project/') && to.endsWith('/overview')) return Briefcase
  if (to.includes('/project/') && (to.endsWith('/orchestrator') || to.endsWith('/po'))) return Bot
  if (/\/project\/[^/]+\/doc/.test(to)) return BookOpen
  if (to.includes('/project/') && to.endsWith('/orchestration')) return Sparkles
  if (to.includes('/project/') && to.endsWith('/notifications')) return Bell
  if (to.includes('/project/') && to.endsWith('/workforce')) return Users
  if (to.includes('/project/') && to.endsWith('/usage')) return Database
  if (to.includes('/project/') && to.endsWith('/communication')) return MessageSquare
  if (to.includes('/project/') && to.endsWith('/request')) return PenLine
  if (to.includes('/project/') && to.endsWith('/messages')) return MessageSquare
  if (to.includes('/project/') && to.endsWith('/settings')) return Shield
  return LayoutDashboard
}

function isLinkActive(to: string, pathname: string, exact?: boolean): boolean {
  if (exact) {
    if (to === '/os') {
      return pathname === '/os' || pathname.startsWith('/os/project/')
    }
    return pathname === to
  }
  // Doc link should remain active for any /doc or /doc/:slug nested route.
  const docMatch = to.match(/^(\/project\/[^/]+\/doc)$/)
  if (docMatch) {
    return pathname === docMatch[1] || pathname.startsWith(`${docMatch[1]}/`)
  }
  // Workspace docs link stays active for child page slugs.
  if (to === '/os/docs' || to === '/projects/docs') {
    return pathname === to || pathname.startsWith(`${to}/`)
  }
  if (to === '/orchestra') {
    return pathname === '/orchestra' || pathname.startsWith('/orchestra/')
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
                <span className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-bg-hover text-text-muted">
                  {t('comingSoon', { defaultValue: 'Coming soon' })}
                </span>
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
              {item.to === '/support/inbox/my' || item.to === '/support/inbox/mine' ? (
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

function resolveGroups(pathname: string, t: TFunction<'nav'>): SidebarGroup[] {
  if (pathname === '/home' || pathname.startsWith('/home/')) return []
  // Wizard routes have their own full-bleed layout — no sidebar groups.
  if (pathname === '/projects/new' || pathname.startsWith('/projects/new/')) return []
  if (isAiOsRoute(pathname)) return getAiOsSidebarGroups(t)
  if (pathname.startsWith('/integrations')) return getIntegrationsSidebarGroups(t)
  if (pathname.startsWith('/settings')) return getSettingsSidebarGroups(t)
  if (
    pathname.startsWith('/users') ||
    pathname.startsWith('/database') ||
    pathname.startsWith('/data/')
  ) {
    return getDataSidebarGroups(t)
  }
  return []
}

function resolveTitle(pathname: string, t: TFunction<['nav']>): string {
  if (pathname === '/home' || pathname.startsWith('/home/')) {
    return t('nav:sectionTitle.home', { defaultValue: isBokitoMode() ? 'Cockpit' : 'Home' })
  }
  if (pathname === '/agenda' || pathname.startsWith('/agenda/')) {
    return t('nav:sectionTitle.agenda', { defaultValue: 'Agenda' })
  }
  if (isAiOsRoute(pathname)) return t('nav:sectionTitle.aiOs', { defaultValue: 'AI OS' })
  if (pathname.startsWith('/users') || pathname.startsWith('/database') || pathname.startsWith('/data/')) {
    return t('nav:sectionTitle.data')
  }
  if (pathname.startsWith('/integrations')) return t('nav:sectionTitle.integrations')
  if (pathname.startsWith('/settings')) return t('nav:sectionTitle.settings')
  if (pathname.startsWith('/support') || pathname.startsWith('/communication')) {
    return t('nav:sectionTitle.inbox')
  }
  return t('nav:sectionTitle.home', { defaultValue: 'Home' })
}

export default function SectionSidebar() {
  const { t } = useTranslation(['nav'])
  const { user } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const projectHubNav = useOptionalProjectHubNav()

  if (pathname === '/home' || pathname.startsWith('/home/')) {
    return null
  }

  // The new-project wizard owns its full-bleed canvas; suppress the sidebar.
  if (pathname === '/projects/new' || pathname.startsWith('/projects/new/')) {
    return null
  }

  const onAiOs = isAiOsRoute(pathname)
  const onProjectHub = onAiOs
  const hubProjects = projectHubNav?.projects ?? []
  const selectedProjectId = projectHubNav?.selectedProjectId ?? null

  const groups = resolveGroups(pathname, t as TFunction<'nav'>)
  const title = resolveTitle(pathname, t)

  const isInbox = pathname.startsWith('/support') || pathname.startsWith('/communication')
  const isAgenda = pathname === '/agenda' || pathname.startsWith('/agenda/')

  if (isAgenda) {
    return (
      <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border/55 bg-bg-sidebar px-3 py-3">
        <h2 className="px-3 pb-3 text-[22px] font-semibold leading-none text-text-heading">{title}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AgendaSidebar />
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border/55 bg-bg-sidebar px-3 py-3">
      <h2 className="px-3 pb-3 text-[22px] font-semibold leading-none text-text-heading">{title}</h2>
      {onProjectHub ? (
        <div className="px-3 pb-2">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-text-muted/90">
            {t('projectHub.selector.label', { defaultValue: 'Current project' })}
          </p>
          {projectHubNav?.error ? (
            <div className="mb-2 rounded-lg border border-status-error/30 bg-status-error/10 px-2.5 py-2">
              <p className="text-xs text-status-error">{projectHubNav.error}</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-1 h-7 px-2 text-xs"
                onClick={() => void projectHubNav.refresh()}
              >
                {t('common:actions.retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          ) : null}
          <Select
            value={selectedProjectId ?? undefined}
            onValueChange={(projectId) => {
              if (projectId === CREATE_PROJECT_VALUE) {
                void navigate('/projects/new')
                return
              }
              projectHubNav?.setSelectedProjectId(projectId)
              void navigate(`/os/project/${projectId}`)
            }}
          >
            <SelectTrigger className="h-8 bg-bg-sidebar px-2.5 text-xs [&>span]:max-w-[150px] [&>span]:truncate">
              <SelectValue
                className="truncate"
                placeholder={t('projectHub.selector.placeholder', { defaultValue: 'Select project' })}
              />
            </SelectTrigger>
            <SelectContent>
              {hubProjects.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  {t('projectHub.selector.none', { defaultValue: 'No projects available' })}
                </SelectItem>
              ) : (
                hubProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))
              )}
              {hubProjects.length > 0 ? <div className="my-1 border-t border-border/60" /> : null}
              <SelectItem value={CREATE_PROJECT_VALUE} className="pl-2.5 font-medium text-text-primary">
                <span className="flex items-center gap-2">
                  <Plus size={12} className="shrink-0 text-accent" />
                  {t('projectHub.selector.create', { defaultValue: 'New project' })}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isInbox ? (
          <InboxSidebarNav />
        ) : (
          <div className="space-y-4">
            {onAiOs ? (
              <>
                {groups.map((group) => (
                  <SidebarGroupBlock key={group.label} group={group} user={user ?? null} pathname={pathname} />
                ))}
                <WorkforceSidebarNav />
              </>
            ) : (
              groups.map((group) => (
                <SidebarGroupBlock key={group.label} group={group} user={user ?? null} pathname={pathname} />
              ))
            )}
            {onProjectHub && (pathname.startsWith('/os/project/') || pathname.startsWith('/project/')) ? (
              <ProjectHubBackgroundWorkersNav />
            ) : null}
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
      {onProjectHub && selectedProjectId ? (
        <div className="mt-2 border-t border-border/40 pt-2">
          <NavLink
            to={`/project/${selectedProjectId}/settings`}
            className={({ isActive }) => sectionClass(isActive)}
          >
            <Settings size={14} className="text-text-muted" />
            <span>{t('projectHub.settingsLink', { defaultValue: 'Project settings' })}</span>
          </NavLink>
        </div>
      ) : null}
    </aside>
  )
}
