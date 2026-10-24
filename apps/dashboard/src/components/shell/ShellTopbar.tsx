import { CircleHelp, Menu, Search, Sparkles } from 'lucide-react'
import { Button } from '../ui/button'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../../context/WorkspaceContext'
import { tabFromPath, titleForTab } from '../../lib/navigation'
import { inAppAssistantEnabled, openAssistant } from '../../lib/personal-assistant-widget'
import { cn } from '../../lib/utils'
import StaffTenantBar from '../layout/StaffTenantBar'
import NotificationDropdown from '../notifications/NotificationDropdown'
import { useOnboardingStatus } from '../onboarding/OnboardingChecklist'
import { SearchField } from '../ui/search-field'
import { Tip } from '../ui/Tip'
import { settingsLinkForPath } from './SettingsLayout'
import { extraCrumbsForPath } from '../../lib/page-crumbs'

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
  const onModuleWorkspace = pathname.startsWith('/connections/')
  const onDepartment = pathname.startsWith('/departments/')
  const pageTitle = tab
    ? t(`tabs.${tab}.title`, { defaultValue: titleForTab(tab) })
    : onDepartment
      ? t('tabGroups.departments', { defaultValue: 'Departments' })
      : onModuleWorkspace
        ? t('tabs.modules.title', { defaultValue: 'Connections' })
        : (currentWorkspace?.name ?? 'Bokito')
  const settingsLink = settingsLinkForPath(pathname)
  const extraCrumbs = extraCrumbsForPath(pathname)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  const trail: string[] = [
    pageTitle,
    ...(settingsLink ? [t(settingsLink.labelKey)] : []),
    ...extraCrumbs.map((crumb) => t(crumb.labelKey)),
  ]

  return (
    <header className="relative flex h-topbar shrink-0 items-center gap-2 bg-transparent pl-2 pr-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Button variant="ghost" size="iconSm"
          type="button"
          onClick={onOpenNavDrawer}
          className="lg:hidden"
          aria-label={t('topbar.openNavigation')}
        >
          <Menu size={16} />
        </Button>

        {/* Breadcrumb. Below md only the last segment shows, as the page title. */}
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 px-1 text-sm text-text-secondary">
          {trail.map((crumb, index) => {
            const last = index === trail.length - 1
            return (
              <span
                key={`${crumb}-${index}`}
                className={cn('min-w-0 items-center gap-1.5', last ? 'flex' : 'hidden md:flex')}
              >
                {index > 0 ? <span className="hidden shrink-0 text-text-muted md:inline">/</span> : null}
                <span className={cn('min-w-0 truncate-fade', last && 'font-medium text-text-heading md:font-normal md:text-text-secondary')}>
                  {crumb}
                </span>
              </span>
            )
          })}
        </nav>
      </div>

      {/* Centered command palette. Conversation search lives in the thread list. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-topbar items-center justify-center sm:flex">
        <Tip label={t('topbar.openPalette')} detail={isMac ? 'Cmd K' : 'Ctrl K'}>
          <div className="pointer-events-auto w-64">
            <SearchField
              value=""
              onChange={() => {}}
              size="sm"
              readOnly
              placeholder={t('topbar.search')}
              aria-label={t('topbar.openPalette')}
              shortcut={isMac ? 'Cmd K' : 'Ctrl K'}
              onClick={onOpenPalette}
              onFocus={(event) => {
                event.currentTarget.blur()
                onOpenPalette()
              }}
            />
          </div>
        </Tip>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <StaffTenantBar />

      {setupIncomplete ? (
        <Tip label={t('topbar.resumeSetup')}>
          <Button variant="secondary" size="xs"
            type="button"
            onClick={() => navigate('/settings/setup')}
            className="hidden md:flex"
          >
            <Sparkles size={14} className="text-accent" />
            <span>{t('topbar.setup')}</span>
          </Button>
        </Tip>
      ) : null}

      <Tip label={t('topbar.help')} detail="?">
        <Button variant="secondary" size="xs"
          type="button"
          onClick={() => {
            if (inAppAssistantEnabled()) openAssistant()
            else navigate('/settings/help')
          }}
          className="hidden md:flex"
        >
          <CircleHelp size={14} className="text-accent" />
          <span>{t('topbar.help')}</span>
        </Button>
      </Tip>
      <Tip label={t('topbar.help')} detail="?">
        <Button variant="ghost" size="iconSm"
          type="button"
          onClick={() => {
            if (inAppAssistantEnabled()) openAssistant()
            else navigate('/settings/help')
          }}
          className="md:hidden"
          aria-label={t('topbar.help')}
        >
          <CircleHelp size={14} />
        </Button>
      </Tip>

      <Tip label={t('topbar.openPalette')} detail={isMac ? 'Cmd K' : 'Ctrl K'}>
        <Button variant="ghost" size="iconSm"
          type="button"
          onClick={onOpenPalette}
          className="sm:hidden"
          aria-label={t('topbar.search')}
        >
          <Search size={14} />
        </Button>
      </Tip>

        <NotificationDropdown />
      </div>
    </header>
  )
}
