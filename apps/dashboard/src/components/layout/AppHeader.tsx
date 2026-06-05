import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { Input } from '../ui/input'
import { getAiPageMeta, getIntegrationsPageMeta, getSettingsPageMeta, getSupportPageMeta, getWorkforcePageMeta } from './portal-nav'
import { useOptionalProjectContext } from '../../context/ProjectContext'
import { useOptionalProjectHubNav } from '../../context/ProjectHubNavContext'
import { useOptionalWorkspaceDocNav } from '../../context/WorkspaceDocNavContext'
import StaffTenantBar from './StaffTenantBar'

export default function AppHeader() {
  const { t } = useTranslation(['nav', 'common'])
  const { pathname, search } = useLocation()
  const showSearch = pathname.startsWith('/settings')
  const settingsPageMeta = getSettingsPageMeta(t)
  const integrationsPageMeta = getIntegrationsPageMeta(t)
  const aiPageMeta = getAiPageMeta(t)
  const workforcePageMeta = getWorkforcePageMeta(t)
  const supportPageMeta = getSupportPageMeta(t)
  const integrationsSlug = pathname.startsWith('/integrations/') ? pathname.split('/')[2] ?? 'marketplace' : ''

  const supportQueue = pathname.split('/')[3] ?? 'all'
  const settingsSlug = pathname.split('/')[2] ?? ''
  const settingsDataSlug = pathname.startsWith('/settings/data/') ? pathname.split('/')[3] ?? '' : ''
  const userSlug = pathname.split('/')[2] ?? ''

  const projectCtx = useOptionalProjectContext()
  const hubNav = useOptionalProjectHubNav()
  const workspaceDocNav = useOptionalWorkspaceDocNav()

  const projectSection = pathname.match(/^\/project\/[^/]+\/([^/]+)/)?.[1]
  const projectSectionTitle =
    projectSection === 'overview'
      ? t('project.links.overview', { defaultValue: 'Overview' })
      : projectSection === 'po' || projectSection === 'orchestrator'
        ? t('project.links.po', { defaultValue: 'Orchestrator' })
      : projectSection === 'pkb' || projectSection === 'doc'
        ? t('project.links.knowledge', { defaultValue: 'Blueprint' })
        : projectSection === 'orchestration'
          ? t('project.links.orchestration', { defaultValue: 'Orchestration' })
          : projectSection === 'communication'
            ? t('project.links.communication', { defaultValue: 'Communication' })
            : projectSection === 'workforce'
              ? t('project.links.workforce', { defaultValue: 'Workforce history' })
              : projectSection === 'usage'
                ? t('project.links.usage', { defaultValue: 'Token usage' })
                : projectSection === 'notifications'
                  ? t('project.links.notifications', { defaultValue: 'Notifications' })
                  : projectSection === 'request'
                    ? t('project.links.request', { defaultValue: 'Request a change' })
                    : projectSection === 'messages'
                      ? t('project.links.messages', { defaultValue: 'Messages' })
                      : projectSection === 'settings'
                        ? t('project.links.settings', { defaultValue: 'Settings' })
                        : null

  let projectBreadcrumb: string | null = null
  if (projectSectionTitle) {
    if (projectSection === 'overview') {
      const streamSlug =
        new URLSearchParams(search).get('stream') ?? hubNav?.workstreams[0]?.slug ?? null
      const stream =
        hubNav?.workstreams.find((row) => row.slug === streamSlug) ?? hubNav?.workstreams[0] ?? null
      projectBreadcrumb = stream?.name ?? projectCtx?.project?.name ?? projectSectionTitle
    } else if (projectSection === 'po' || projectSection === 'orchestrator') {
      projectBreadcrumb = projectSectionTitle
    } else {
      const projectName = projectCtx?.project?.name ?? null
      const parts = [projectName, projectSectionTitle].filter(
        (s): s is string => Boolean(s && s.trim()),
      )
      projectBreadcrumb = parts.length ? parts.join(' / ') : projectSectionTitle
    }
  }

  const onAiOsHub =
    pathname === '/os' ||
    pathname === '/os/communication' ||
    pathname === '/os/docs' ||
    pathname.startsWith('/os/docs/') ||
    pathname.startsWith('/os/project/')
  const onProjectHub =
    onAiOsHub ||
    pathname === '/projects' ||
    pathname === '/projects/communication' ||
    pathname === '/projects/docs' ||
    pathname.startsWith('/projects/docs/')
  let projectHubTitle: string | null = null
  if (onProjectHub) {
    const osProjectId = pathname.match(/^\/os\/project\/([^/]+)/)?.[1] ?? null
    const tabKey =
      pathname === '/os' || pathname === '/projects' || osProjectId
        ? 'overview'
        : pathname === '/os/communication' || pathname === '/projects/communication'
          ? 'decisions'
          : 'docs'
    let docPageTitle: string | null = null
    if (tabKey === 'docs') {
      const slug =
        pathname.match(/^\/os\/docs\/([^/]+)/)?.[1] ??
        pathname.match(/^\/projects\/docs\/([^/]+)/)?.[1] ??
        null
      if (slug && workspaceDocNav?.pages?.length) {
        const match = workspaceDocNav.pages.find((p) => p.slug === slug)
        if (match) docPageTitle = match.title
      }
    }
    const hubLabel = onAiOsHub
      ? t('nav:sectionTitle.aiOs', { defaultValue: 'AI OS' })
      : t('nav:sectionTitle.projectHub', { defaultValue: 'Project hub' })
    const osProjectName =
      osProjectId && hubNav?.projects.find((p) => p.id === osProjectId)?.name
    const tabLabel = osProjectName ?? t(`nav:projectHub.tabs.${tabKey}`)
    const parts = [hubLabel, tabLabel, docPageTitle].filter(
      (s): s is string => Boolean(s && s.trim()),
    )
    projectHubTitle = parts.length ? parts.join(' / ') : hubLabel
  }

  const title = projectBreadcrumb
    ? projectBreadcrumb
    : projectHubTitle
      ? projectHubTitle
      : pathname === '/home' || pathname.startsWith('/home/')
      ? t('nav:home.title')
      : pathname === '/orchestra' || pathname.startsWith('/orchestra/')
        ? `${t('nav:sectionTitle.aiOs', { defaultValue: 'AI OS' })} / ${t('nav:orchestra.title', { defaultValue: 'Orchestra' })}`
        : pathname === '/agenda' || pathname.startsWith('/agenda/')
          ? t('nav:agenda.title', { defaultValue: 'Agenda' })
          : pathname.startsWith('/support/inbox/')
    ? supportPageMeta[supportQueue ?? 'all']?.title ?? t('nav:fallbackTitles.supportInbox')
    : pathname.startsWith('/support/customization')
      ? t('nav:settingsPageMeta.messenger.title')
      : pathname.startsWith('/support/settings')
        ? t('nav:fallbackTitles.emailConnections')
        : pathname.startsWith('/users')
          ? settingsPageMeta[userSlug]?.title ?? t('nav:fallbackTitles.users')
          : pathname.startsWith('/database')
            ? t('nav:fallbackTitles.database')
            : pathname.startsWith('/communication')
              ? t('nav:fallbackTitles.supportInbox')
              : pathname.startsWith('/workspaces')
                ? t('nav:fallbackTitles.workspaces')
              : pathname.startsWith('/ai/')
                ? aiPageMeta[pathname.split('/')[2] ?? 'assistent']?.title ??
                  t('nav:sectionTitle.workforce', { defaultValue: 'Workforce' })
                : pathname.startsWith('/projects/new/') && pathname.includes('/connect')
                  ? t('nav:projects.header.connect', { defaultValue: 'Connect your code' })
                  : pathname.startsWith('/projects/new')
                    ? t('nav:projects.header.new', { defaultValue: 'Create project' })
                    : pathname.startsWith('/os')
                      ? t('nav:sectionTitle.aiOs', { defaultValue: 'AI OS' })
                      : pathname.startsWith('/projects')
                        ? t('nav:sectionTitle.projectHub', { defaultValue: 'Project hub' })
                      : pathname.startsWith('/integrations')
                        ? integrationsPageMeta[integrationsSlug]?.title ?? t('nav:sectionTitle.integrations')
                        : pathname.startsWith('/admin/runs')
                          ? t('nav:workforce.pageMeta.overview.title', { defaultValue: 'Workforce overview' })
                          : pathname.startsWith('/workforce/')
                            ? workforcePageMeta[pathname.split('/')[2] ?? 'agents']?.title ??
                              t('nav:sectionTitle.workforce', { defaultValue: 'Workforce' })
                          : pathname.startsWith('/data/')
                            ? pathname.startsWith('/data/sources')
                              ? t('nav:integrations.pageMeta.sources.title')
                              : t('nav:data.links.importsExports', { defaultValue: 'Import and export' })
                            : pathname.startsWith('/settings')
                              ? settingsPageMeta[(settingsSlug === 'data' ? settingsDataSlug : settingsSlug) ?? 'profile']?.title ??
                                t('nav:fallbackTitles.settings')
                              : t('nav:fallbackTitles.portal')

  return (
    <header
      className={`grid h-16 items-center gap-3 border-b border-border/55 px-5 pt-2 pb-3 ${
        showSearch ? 'grid-cols-[1fr_auto_minmax(280px,440px)]' : 'grid-cols-[1fr_auto]'
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-[16px] font-semibold text-text-heading">{title}</p>
      </div>
      <StaffTenantBar />
      {showSearch ? (
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            name="portal-search"
            autoComplete="off"
            placeholder={t('common:search.placeholder')}
            className="h-9 rounded-lg border-border/70 bg-bg-input/70 pl-9 text-sm"
          />
        </div>
      ) : null}
    </header>
  )
}
