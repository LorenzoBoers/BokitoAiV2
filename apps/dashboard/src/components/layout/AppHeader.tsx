import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { Input } from '../ui/input'
import { getAiPageMeta, getIntegrationsPageMeta, getSettingsPageMeta, getSupportPageMeta } from './portal-nav'
import { useOptionalProjectContext } from '../../context/ProjectContext'
import { useOptionalProjectDocNav } from '../../context/ProjectDocNavContext'

export default function AppHeader() {
  const { t } = useTranslation(['nav', 'common'])
  const { pathname } = useLocation()
  const showSearch = pathname.startsWith('/settings')
  const settingsPageMeta = getSettingsPageMeta(t)
  const integrationsPageMeta = getIntegrationsPageMeta(t)
  const aiPageMeta = getAiPageMeta(t)
  const supportPageMeta = getSupportPageMeta(t)
  const integrationsSlug = pathname.startsWith('/integrations/') ? pathname.split('/')[2] ?? 'marketplace' : ''

  const supportQueue = pathname.split('/')[3] ?? 'all'
  const settingsSlug = pathname.split('/')[2] ?? ''
  const settingsDataSlug = pathname.startsWith('/settings/data/') ? pathname.split('/')[3] ?? '' : ''
  const userSlug = pathname.split('/')[2] ?? ''

  const projectCtx = useOptionalProjectContext()
  const docNav = useOptionalProjectDocNav()

  const projectSection = pathname.match(/^\/project\/[^/]+\/([^/]+)/)?.[1]
  const projectSectionTitle =
    projectSection === 'overview'
      ? t('project.links.overview', { defaultValue: 'Overview' })
      : projectSection === 'pkb' || projectSection === 'doc'
        ? t('project.links.knowledge', { defaultValue: 'Documentation' })
        : projectSection === 'request'
          ? t('project.links.request', { defaultValue: 'Request a change' })
          : projectSection === 'messages'
            ? t('project.links.messages', { defaultValue: 'Messages' })
            : projectSection === 'settings'
              ? t('project.links.settings', { defaultValue: 'Settings' })
              : null

  let projectBreadcrumb: string | null = null
  if (projectSectionTitle) {
    const projectName = projectCtx?.project?.name ?? null
    let docPageTitle: string | null = null
    if (projectSection === 'doc') {
      const slug = pathname.match(/^\/project\/[^/]+\/doc\/([^/]+)/)?.[1] ?? null
      if (slug && docNav?.pages?.length) {
        const match = docNav.pages.find((p) => p.slug === slug)
        if (match) docPageTitle = match.title
      }
    }
    const parts = [projectName, projectSectionTitle, docPageTitle].filter(
      (s): s is string => Boolean(s && s.trim()),
    )
    projectBreadcrumb = parts.length ? parts.join(' / ') : projectSectionTitle
  }

  const title = projectBreadcrumb
    ? projectBreadcrumb
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
                  t('nav:settingsPageMeta.messenger.title')
                : pathname.startsWith('/projects/new/') && pathname.includes('/connect')
                  ? t('nav:projects.header.connect', { defaultValue: 'Connect your code' })
                  : pathname.startsWith('/projects/new')
                    ? t('nav:projects.header.new', { defaultValue: 'Create project' })
                    : pathname.startsWith('/projects')
                      ? t('nav:rail.projects', { defaultValue: 'Projects' })
                      : pathname.startsWith('/integrations')
                        ? integrationsPageMeta[integrationsSlug]?.title ?? t('nav:sectionTitle.integrations')
                        : pathname.startsWith('/admin/runs')
                          ? t('nav:workforce.links.runs', { defaultValue: 'Agent runs' })
                          : pathname.startsWith('/workforce')
                            ? t('nav:fallbackTitles.workforce')
                            : pathname.startsWith('/settings')
                              ? settingsPageMeta[(settingsSlug === 'data' ? settingsDataSlug : settingsSlug) ?? 'profile']?.title ??
                                t('nav:fallbackTitles.settings')
                              : t('nav:fallbackTitles.portal')

  return (
    <header
      className={`grid h-16 items-center gap-3 border-b border-border/55 px-5 pt-2 pb-3 ${
        showSearch ? 'grid-cols-[1fr_minmax(280px,440px)]' : 'grid-cols-[1fr]'
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-[16px] font-semibold text-text-heading">{title}</p>
      </div>
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
