import { Bell, Building2, LogOut, Plus, SlidersHorizontal, SunMoon, UserCircle2 } from 'lucide-react'
import { UserAvatar } from '../ui/UserAvatar'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useTheme } from '../../context/ThemeContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { getRailItems } from './portal-nav'

export default function Sidebar() {
  const { t } = useTranslation(['nav', 'common'])
  const { user, logout } = useAuth()
  const { currentWorkspace, workspaces, switchWorkspace } = useWorkspace()
  const { isDark, toggleMode } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const displayName = user?.name ?? t('common:account')
  const railItems = getRailItems(t)
  const mainRailItems = railItems.filter((item) => item.to !== '/settings/profile')

  const isRailActive = (path: string): boolean => {
    if (path === '/support/inbox/all') {
      return location.pathname.startsWith('/support') || location.pathname.startsWith('/communication')
    }
    if (path === '/docs') {
      return location.pathname.startsWith('/docs')
    }
    if (path === '/projects') {
      return location.pathname.startsWith('/projects') || location.pathname.startsWith('/datasources') || location.pathname.startsWith('/ai')
    }
    if (path === '/database') {
      return location.pathname.startsWith('/database')
    }
    if (path === '/workforce') {
      return location.pathname.startsWith('/workforce')
    }
    if (path === '/users/attributes') {
      return location.pathname.startsWith('/users')
    }
    if (path === '/settings/profile') {
      return location.pathname.startsWith('/settings') || location.pathname.startsWith('/integrations') || location.pathname.startsWith('/company-config')
    }
    return false
  }

  return (
    <aside className="flex h-full w-[62px] flex-col p-2">
      <div className="flex h-12 items-center justify-center">
        <img
          src="/bokito-logo.svg"
          alt="Bokito AI"
          className="h-8 w-8 object-contain"
          style={{
            filter: isDark
              ? 'brightness(0) saturate(100%) invert(98%) sepia(2%) saturate(1312%) hue-rotate(188deg) brightness(112%) contrast(93%)'
              : 'brightness(0) saturate(100%) invert(53%) sepia(9%) saturate(428%) hue-rotate(183deg) brightness(91%) contrast(88%)',
          }}
        />
      </div>

      <TooltipProvider delayDuration={100}>
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 py-3">
          {mainRailItems.map((item) => {
            const Icon = item.icon
            const isActive = isRailActive(item.to)
            if (item.comingSoon) {
              return (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-text-muted/40 opacity-50 cursor-not-allowed"
                      tabIndex={-1}
                    >
                      <Icon size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="flex flex-col items-start gap-0.5">
                    <span>{item.label}</span>
                    <span className="text-accent text-[11px] font-semibold">Binnenkort</span>
                  </TooltipContent>
                </Tooltip>
              )
            }
            return (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={item.to}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                      isActive
                        ? 'border-accent/35 bg-accent/20 text-accent shadow-[0_0_0_1px_rgba(110,102,255,0.28),0_10px_20px_-16px_rgba(63,81,181,0.6)]'
                        : 'border-transparent text-text-muted hover:border-border/65 hover:bg-bg-hover/70 hover:text-text-primary'
                    }`}
                  >
                    <Icon size={18} />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </nav>

        <div className="space-y-2 px-1 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <NavLink
                to="/settings/profile"
                className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                  isRailActive('/settings/profile')
                    ? 'border-accent/35 bg-accent/20 text-accent shadow-[0_0_0_1px_rgba(110,102,255,0.28),0_10px_20px_-16px_rgba(63,81,181,0.6)]'
                    : 'border-transparent text-text-muted hover:border-border/65 hover:bg-bg-hover/70 hover:text-text-primary'
                }`}
              >
                <SlidersHorizontal size={18} />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{t('nav:rail.settings')}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden transition-opacity hover:opacity-80"
                aria-label={t('nav:userMenu.openAria')}
              >
                <UserAvatar name={user?.name ?? displayName} email={user?.email ?? ''} avatarUrl={user?.avatarUrl} size={40} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56">
              <DropdownMenuItem onClick={() => navigate('/settings/profile')}>
                <UserCircle2 size={14} className="mr-2 text-text-muted" />
                {t('nav:userMenu.profile')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings/notifications')}>
                <Bell size={14} className="mr-2 text-text-muted" />
                {t('nav:userMenu.notificationPreferences')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleMode}>
                <SunMoon size={14} className="mr-2 text-text-muted" />
                {isDark ? t('nav:userMenu.lightMode') : t('nav:userMenu.darkMode')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/workspaces')}>
                <Building2 size={14} className="mr-2 text-text-muted" />
                {t('nav:userMenu.workspaces')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('nav:workspace.currentWorkspace')}</DropdownMenuLabel>
              <DropdownMenuItem disabled>
                <Building2 size={14} className="mr-2 text-text-muted" />
                {currentWorkspace?.name ?? t('nav:workspace.none')}
              </DropdownMenuItem>
              {workspaces.length > 1 ? (
                <DropdownMenuLabel>{t('nav:workspace.switchTo')}</DropdownMenuLabel>
              ) : null}
              {workspaces.length === 0 ? (
                <DropdownMenuItem onClick={() => navigate('/workspaces')}>
                  <Plus size={14} className="mr-2 text-text-muted" />
                  {t('nav:workspace.createFirst')}
                </DropdownMenuItem>
              ) : (
                workspaces
                  .filter((workspace) => workspace.id !== currentWorkspace?.id)
                  .map((workspace) => {
                  const isActive = currentWorkspace?.id === workspace.id
                  return (
                    <DropdownMenuItem
                      key={workspace.id}
                      onClick={() => void switchWorkspace(workspace.id)}
                      className={isActive ? 'bg-bg-hover text-text-primary' : undefined}
                    >
                      <Building2 size={14} className="mr-2 text-text-muted" />
                      <span className="truncate">{workspace.name}</span>
                      {isActive ? <span className="ml-auto text-xs text-text-muted">{t('nav:workspace.current')}</span> : null}
                    </DropdownMenuItem>
                  )
                  })
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut size={14} className="mr-2 text-text-muted" />
                {t('common:actions.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipProvider>
    </aside>
  )
}
