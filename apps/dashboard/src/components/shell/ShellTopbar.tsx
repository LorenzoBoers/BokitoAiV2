import { Building2, ChevronDown, CircleHelp, LogOut, Menu, Search, Settings, Sparkles, UserCircle2 } from 'lucide-react'
import { useLocation, useNavigate, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { buildControlPlaneUrl } from '../../lib/host-routing'
import { REPORTS_PATH, tabFromPath, titleForTab } from '../../lib/navigation'
import { UserAvatar } from '../ui/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import StaffTenantBar from '../layout/StaffTenantBar'
import NotificationDropdown from '../notifications/NotificationDropdown'
import { useOnboardingStatus } from '../onboarding/OnboardingChecklist'
import { settingsLinkForPath } from './SettingsLayout'
import { extraCrumbsForPath } from '../../lib/page-crumbs'

type ShellTopbarProps = {
  onOpenNavDrawer: () => void
  onOpenPalette: () => void
}

export default function ShellTopbar({ onOpenNavDrawer, onOpenPalette }: ShellTopbarProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation('nav')
  const { user, logout } = useAuth()
  const { status: onboardingStatus } = useOnboardingStatus()
  const setupIncomplete = Boolean(onboardingStatus && !onboardingStatus.completed)
  const { currentWorkspace, workspaces, switchWorkspace } = useWorkspace()
  const tab = tabFromPath(pathname)
  const onModuleWorkspace =
    pathname.startsWith('/connections/') && !pathname.startsWith('/connections/marketplace')
  const pageTitle = tab
    ? t(`tabs.${tab}.title`, { defaultValue: titleForTab(tab) })
    : onModuleWorkspace
      ? t('tabGroups.modules', { defaultValue: 'Modules' })
      : 'Bokito'
  const settingsLink = settingsLinkForPath(pathname)
  const extraCrumbs = extraCrumbsForPath(pathname)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const workspaceName = currentWorkspace?.name?.trim() ?? ''
  const workspaceMatchesBrand = workspaceName.toLowerCase() === 'bokito'

  const goToWorkspacesHub = () => {
    // On a tenant subdomain the hub lives on the control-plane host, so cross-navigate
    // there. Same-origin (app host / loopback dev) stays a client-side route change.
    const controlPlaneUrl = buildControlPlaneUrl('/workspaces')
    if (controlPlaneUrl && typeof window !== 'undefined') {
      try {
        if (new URL(controlPlaneUrl).origin !== window.location.origin) {
          window.location.assign(controlPlaneUrl)
          return
        }
      } catch {
        /* fall through to client-side navigation */
      }
    }
    navigate('/workspaces')
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/40 bg-bg-sidebar/60 pl-3 pr-3">
      <button
        type="button"
        onClick={onOpenNavDrawer}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary lg:hidden"
        aria-label={t('topbar.openNavigation')}
      >
        <Menu size={16} />
      </button>

      {/* Breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
        {currentWorkspace && workspaceMatchesBrand ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-text-heading transition-colors hover:bg-bg-hover/60 hover:text-accent"
              >
                <span className="min-w-0 truncate">{workspaceName}</span>
                <ChevronDown size={12} className="shrink-0 text-text-muted" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>{t('topbar.switchWorkspace')}</DropdownMenuLabel>
              {workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => {
                    if (workspace.id !== currentWorkspace.id) void switchWorkspace(workspace.id)
                  }}
                  className={workspace.id === currentWorkspace.id ? 'bg-bg-hover text-text-primary' : undefined}
                >
                  <Building2 size={14} className="mr-2 text-text-muted" />
                  <span className="truncate">{workspace.name}</span>
                  {workspace.id === currentWorkspace.id ? (
                    <span className="ml-auto text-xs text-text-muted">{t('topbar.current')}</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate(REPORTS_PATH)}>
                <Building2 size={14} className="mr-2 text-text-muted" />
                {t('tabs.overview.title', { defaultValue: 'Overview' })}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={goToWorkspacesHub}>
                <Building2 size={14} className="mr-2 text-text-muted" />
                {t('topbar.allWorkspaces')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <NavLink to="/" className="shrink-0 font-semibold text-text-heading hover:text-accent">
            Bokito
          </NavLink>
        )}
        {currentWorkspace && !workspaceMatchesBrand ? (
          <>
            <span className="shrink-0 text-text-muted/60">/</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  <span className="min-w-0 truncate">{workspaceName}</span>
                  <ChevronDown size={12} className="shrink-0 text-text-muted" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>{t('topbar.switchWorkspace')}</DropdownMenuLabel>
                {workspaces.map((workspace) => (
                  <DropdownMenuItem
                    key={workspace.id}
                    onClick={() => {
                      if (workspace.id !== currentWorkspace.id) void switchWorkspace(workspace.id)
                    }}
                    className={workspace.id === currentWorkspace.id ? 'bg-bg-hover text-text-primary' : undefined}
                  >
                    <Building2 size={14} className="mr-2 text-text-muted" />
                    <span className="truncate">{workspace.name}</span>
                    {workspace.id === currentWorkspace.id ? (
                      <span className="ml-auto text-xs text-text-muted">{t('topbar.current')}</span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={goToWorkspacesHub}>
                  <Building2 size={14} className="mr-2 text-text-muted" />
                  {t('topbar.allWorkspaces')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
        <span className="shrink-0 text-text-muted/60">/</span>
        <span className="min-w-0 truncate text-text-primary">{pageTitle}</span>
        {settingsLink ? (
          <>
            <span className="shrink-0 text-text-muted/60">/</span>
            <span className="min-w-0 truncate text-text-secondary">{t(settingsLink.labelKey)}</span>
          </>
        ) : null}
        {extraCrumbs.map((crumb) => (
          <span key={crumb.labelKey} className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-text-muted/60">/</span>
            <span className="min-w-0 truncate text-text-secondary">{t(crumb.labelKey)}</span>
          </span>
        ))}
      </div>

      <StaffTenantBar />

      {setupIncomplete ? (
        <button
          type="button"
          onClick={() => navigate('/settings/setup')}
          className="hidden items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/15 md:flex"
          title={t('topbar.resumeSetup')}
        >
          <Sparkles size={12} />
          <span>{t('topbar.setup')}</span>
        </button>
      ) : null}

      {/* Command palette trigger — conversation search lives in the thread list. */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="hidden items-center gap-2 rounded-lg border border-border/60 bg-bg-elevated/60 px-3 py-1.5 text-[12px] text-text-muted transition-[border-color,color,box-shadow,background-color] duration-200 hover:border-accent/35 hover:bg-bg-surface hover:text-text-secondary hover:shadow-sm sm:flex"
        title={t('topbar.openPalette')}
      >
        <Search size={12} />
        <span>{t('topbar.search')}</span>
        <kbd className="rounded border border-border/60 bg-bg/60 px-1 font-mono text-[10px] text-text-muted">
          {isMac ? 'Cmd' : 'Ctrl'} K
        </kbd>
      </button>
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary sm:hidden"
        aria-label={t('topbar.search')}
      >
        <Search size={15} />
      </button>

      {/* Notifications */}
      <NotificationDropdown />

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full ring-0 transition-[box-shadow,transform] duration-200 hover:ring-2 hover:ring-accent/25 active:scale-95"
            aria-label={t('topbar.openUserMenu')}
          >
            <UserAvatar name={user?.name ?? 'Account'} email={user?.email ?? ''} avatarUrl={user?.avatarUrl} size={32} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="truncate">{user?.name ?? 'Account'}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => navigate('/settings/profile')}>
            <UserCircle2 size={14} className="mr-2 text-text-muted" />
            {t('topbar.profile')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/settings')}>
            <Settings size={14} className="mr-2 text-text-muted" />
            {t('topbar.settings')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={goToWorkspacesHub}>
            <Building2 size={14} className="mr-2 text-text-muted" />
            {t('topbar.workspaces')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/settings/help')}>
            <CircleHelp size={14} className="mr-2 text-text-muted" />
            {t('topbar.help')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut size={14} className="mr-2 text-text-muted" />
            {t('topbar.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
