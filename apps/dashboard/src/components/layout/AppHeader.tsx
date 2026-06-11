import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { Input } from '../ui/input'
import { getAiPageMeta, getIntegrationsPageMeta, getSettingsPageMeta, getSupportPageMeta } from './portal-nav'
import StaffTenantBar from './StaffTenantBar'

export default function AppHeader() {
  const { t } = useTranslation(['nav', 'common'])
  const { pathname } = useLocation()
  const showSearch = pathname.startsWith('/settings')
  const settingsPageMeta = getSettingsPageMeta(t)
  const integrationsPageMeta = getIntegrationsPageMeta(t)
  const aiPageMeta = getAiPageMeta(t)
  const supportPageMeta = getSupportPageMeta(t)
  const integrationsSlug = pathname.startsWith('/integrations/') ? pathname.split('/')[2] ?? 'marketplace' : ''

  const supportQueue = pathname.startsWith('/messages/ch/')
    ? pathname.split('/')[4] ?? 'all'
    : pathname.startsWith('/messages/')
      ? pathname.split('/')[2] ?? 'all'
      : pathname.split('/')[3] ?? 'all'
  const settingsSlug = pathname.split('/')[2] ?? ''

  const title =
    pathname === '/home' || pathname.startsWith('/home/')
      ? t('nav:home.title')
      : pathname === '/automations' || pathname.startsWith('/automations/')
        ? t('nav:sectionTitle.automations', { defaultValue: 'Automations' })
        : pathname === '/govern' || pathname.startsWith('/govern/')
          ? t('nav:sectionTitle.govern', { defaultValue: 'Govern' })
          : pathname.startsWith('/messages/')
            ? supportPageMeta[supportQueue ?? 'all']?.title ?? t('nav:sectionTitle.inbox', { defaultValue: 'Messages' })
            : pathname.startsWith('/agents')
              ? t('nav:sectionTitle.agents', { defaultValue: 'Agents' })
              : pathname.startsWith('/workspace')
                ? t('nav:sectionTitle.workspace', { defaultValue: 'Workspace' })
                : pathname.startsWith('/ai/')
                  ? aiPageMeta[pathname.split('/')[2] ?? 'assistent']?.title ??
                    t('nav:sectionTitle.agents', { defaultValue: 'Agents' })
                  : pathname.startsWith('/integrations')
                    ? integrationsPageMeta[integrationsSlug]?.title ?? t('nav:sectionTitle.integrations')
                    : pathname.startsWith('/workspaces')
                      ? t('nav:fallbackTitles.workspaces')
                      : pathname.startsWith('/settings')
                        ? settingsPageMeta[settingsSlug || 'profile']?.title ?? t('nav:fallbackTitles.settings')
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
