import { Menu, Search, Sparkles } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../../context/WorkspaceContext'
import { tabFromPath, titleForTab } from '../../lib/navigation'
import { PageGuideLink } from '../layout/PageGuideLink'
import StaffTenantBar from '../layout/StaffTenantBar'
import NotificationDropdown from '../notifications/NotificationDropdown'
import { useOnboardingStatus } from '../onboarding/OnboardingChecklist'
import { Tip } from '../ui/Tip'
import { settingsLinkForPath } from './SettingsLayout'
import { extraCrumbsForPath } from '../../lib/page-crumbs'
import { pageGuideForPath } from '../../lib/page-guides'

type ShellTopbarProps = {
  onOpenNavDrawer: () => void
  onOpenPalette: () => void
}

/**
 * Slim topbar: breadcrumb, setup nudge, search, notifications.
 * Workspace switching and the account menu live in the rail.
 */
export default function ShellTopbar({ onOpenNavDrawer, onOpenPalette }: ShellTopbarProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation('nav')
  const { status: onboardingStatus } = useOnboardingStatus()
  const { currentWorkspace } = useWorkspace()
  const onSetupPage = pathname.startsWith('/settings/setup')
  // Hide on the setup guide itself — repeating "Get started" there feels stuck.
  const setupIncomplete = Boolean(onboardingStatus && !onboardingStatus.completed) && !onSetupPage
  const tab = tabFromPath(pathname)
  const onModuleWorkspace =
    pathname.startsWith('/connections/') && !pathname.startsWith('/connections/marketplace')
  const pageTitle = tab
    ? t(`tabs.${tab}.title`, { defaultValue: titleForTab(tab) })
    : onModuleWorkspace
      ? t('tabGroups.connections', { defaultValue: 'Connections' })
      : (currentWorkspace?.name ?? 'Bokito')
  const settingsLink = settingsLinkForPath(pathname)
  const extraCrumbs = extraCrumbsForPath(pathname)
  const pageGuide = pageGuideForPath(pathname)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  const crumbs: string[] = [
    ...(settingsLink ? [t(settingsLink.labelKey)] : []),
    ...extraCrumbs.map((crumb) => t(crumb.labelKey)),
  ]

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-bg pl-2 pr-2">
      <button
        type="button"
        onClick={onOpenNavDrawer}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover/70 hover:text-text-primary lg:hidden"
        aria-label={t('topbar.openNavigation')}
      >
        <Menu size={15} />
      </button>

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-sm">
        <span className={`min-w-0 truncate-fade ${crumbs.length ? 'text-text-secondary' : 'font-medium text-text-heading'}`}>
          {pageTitle}
        </span>
        {pageGuide ? <PageGuideLink page={pageGuide} compact className="h-6 w-6" /> : null}
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <span key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-text-muted/70">/</span>
              <span className={`min-w-0 truncate-fade ${last ? 'font-medium text-text-heading' : 'text-text-secondary'}`}>
                {crumb}
              </span>
            </span>
          )
        })}
      </nav>

      <StaffTenantBar />

      {setupIncomplete ? (
        <Tip label={t('topbar.resumeSetup')}>
          <button
            type="button"
            onClick={() => navigate('/settings/setup')}
            className="hidden h-7 items-center gap-1.5 rounded-md border border-border/70 px-2 text-xs font-medium text-text-secondary transition-colors hover:border-border-light hover:bg-bg-hover/60 hover:text-text-heading md:flex"
          >
            <Sparkles size={12} className="text-accent" />
            <span>{t('topbar.setup')}</span>
          </button>
        </Tip>
      ) : null}

      {/* Command palette trigger — conversation search lives in the thread list. */}
      <Tip label={t('topbar.openPalette')}>
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden h-7 w-56 items-center gap-2 rounded-md border border-border/70 bg-bg-elevated/40 px-2 text-xs text-text-muted transition-colors hover:border-border-light hover:text-text-secondary sm:flex"
        >
          <Search size={12} />
          <span className="flex-1 text-left">{t('topbar.search')}</span>
          <kbd className="rounded-sm border border-border/70 px-1 font-mono text-2xs text-text-muted">
            {isMac ? 'Cmd' : 'Ctrl'} K
          </kbd>
        </button>
      </Tip>
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover/70 hover:text-text-primary sm:hidden"
        aria-label={t('topbar.search')}
      >
        <Search size={14} />
      </button>

      <NotificationDropdown />
    </header>
  )
}
