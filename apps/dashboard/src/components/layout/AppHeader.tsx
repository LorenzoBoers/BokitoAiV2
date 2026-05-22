import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { Input } from '../ui/input'
import { getSettingsPageMeta, getSupportPageMeta } from './portal-nav'

export default function AppHeader() {
  const { t } = useTranslation(['nav', 'common'])
  const { pathname } = useLocation()
  const showSearch = pathname.startsWith('/settings')
  const settingsPageMeta = getSettingsPageMeta(t)
  const supportPageMeta = getSupportPageMeta(t)

  const supportQueue = pathname.split('/')[3] ?? 'all'
  const settingsSlug = pathname.split('/')[2] ?? ''
  const settingsDataSlug = pathname.startsWith('/settings/data/') ? pathname.split('/')[3] ?? '' : ''
  const userSlug = pathname.split('/')[2] ?? ''

  const title = pathname.startsWith('/support/inbox/')
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
              : pathname.startsWith('/ai/assistent')
                ? t('nav:settingsPageMeta.messenger.title')
              : pathname.startsWith('/projects') || pathname.startsWith('/datasources') || pathname.startsWith('/ai')
                ? t('nav:fallbackTitles.documents')
                : pathname.startsWith('/workforce')
                  ? t('nav:fallbackTitles.workforce')
          : pathname.startsWith('/settings')
            ? settingsPageMeta[(settingsSlug === 'data' ? settingsDataSlug : settingsSlug) ?? 'profile']?.title ?? t('nav:fallbackTitles.settings')
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
