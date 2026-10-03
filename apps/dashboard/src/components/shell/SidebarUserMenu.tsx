import { Building2, Check, ChevronsUpDown, CircleHelp, LaptopMinimal, LogOut, Moon, Settings, Sun, UserCircle2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useTheme, type ThemeMode } from '../../context/ThemeContext'
import { APP_VERSION } from '../../lib/app-version'
import { UserAvatar } from '../ui/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { useGatewayStatus } from './ConnectionStatus'
import { useGoToWorkspacesHub } from './SidebarWorkspaceSwitcher'

const STATUS_DOT = {
  connected: 'bg-status-success',
  connecting: 'bg-status-warning',
  disconnected: 'bg-status-error',
} as const

const THEME_MODES: { value: ThemeMode; icon: typeof Moon }[] = [
  { value: 'dark', icon: Moon },
  { value: 'light', icon: Sun },
  { value: 'system', icon: LaptopMinimal },
]

type SidebarUserMenuProps = {
  collapsed: boolean
  onNavigate?: () => void
}

/**
 * Account row at the foot of the rail (avatar, name, email) that opens the
 * user menu upwards. Theme choice, version and gateway status live here.
 */
export default function SidebarUserMenu({ collapsed, onNavigate }: SidebarUserMenuProps) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { mode, setMode } = useTheme()
  const status = useGatewayStatus()
  const goToWorkspacesHub = useGoToWorkspacesHub()
  const name = user?.name?.trim() || 'Account'
  const email = user?.email ?? ''
  const statusLabel = t(`gateway.${status}`)

  const go = (path: string) => {
    navigate(path)
    onNavigate?.()
  }

  const avatar = (
    <span className="relative shrink-0">
      <UserAvatar name={name} email={email} avatarUrl={user?.avatarUrl} size={collapsed ? 24 : 24} />
      <span
        className={`absolute -bottom-px -right-px h-2 w-2 rounded-full ring-2 ring-bg ${STATUS_DOT[status]}`}
        title={statusLabel}
        aria-hidden
      />
    </span>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('topbar.openUserMenu')}
          title={collapsed ? name : undefined}
          className={`flex items-center gap-2 rounded-md text-left transition-colors hover:bg-bg-hover/70 data-[state=open]:bg-bg-hover ${
            collapsed ? 'h-9 w-9 justify-center' : 'h-10 w-full px-1.5'
          }`}
        >
          {avatar}
          {collapsed ? null : (
            <>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate-fade text-sm font-medium text-text-heading">{name}</span>
                {email ? <span className="truncate-fade text-2xs text-text-muted">{email}</span> : null}
              </span>
              <ChevronsUpDown size={12} className="shrink-0 text-text-muted" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align={collapsed ? 'start' : 'start'}
        sideOffset={6}
        className="w-60"
      >
        <DropdownMenuLabel className="flex min-w-0 flex-col gap-0 normal-case tracking-normal">
          <span className="truncate-fade text-sm font-medium text-text-heading">{name}</span>
          {email ? <span className="truncate-fade text-2xs font-normal text-text-muted">{email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => go('/settings/profile')}>
          <UserCircle2 size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
          {t('topbar.profile')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => go('/settings')}>
          <Settings size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
          {t('topbar.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            goToWorkspacesHub()
            onNavigate?.()
          }}
        >
          <Building2 size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
          {t('topbar.workspaces')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => go('/settings/help')}>
          <CircleHelp size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
          {t('topbar.help')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('theme.label', { defaultValue: 'Theme' })}</DropdownMenuLabel>
        {THEME_MODES.map(({ value, icon: Icon }) => {
          const selected = mode === value
          return (
            <DropdownMenuItem
              key={value}
              onSelect={(event) => {
                event.preventDefault()
                setMode(value)
              }}
              className={selected ? 'bg-bg-hover' : undefined}
              aria-checked={selected}
              role="menuitemradio"
            >
              <Icon size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
              {t(`theme.${value}`)}
              {selected ? (
                <Check size={14} className="ml-auto shrink-0 text-text-heading" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOut size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
          {t('topbar.signOut')}
        </DropdownMenuItem>
        <div className="flex items-center justify-between px-2 pb-1 pt-1.5 text-2xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
            {statusLabel}
          </span>
          <span title={`build ${APP_VERSION}`}>v{APP_VERSION}</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
