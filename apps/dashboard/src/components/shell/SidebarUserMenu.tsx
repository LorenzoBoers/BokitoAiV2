import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Building2, Check, ChevronsUpDown, CircleHelp, LaptopMinimal, LogOut, Moon, Settings, Sun, UserCircle2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useTheme, type ThemeMode } from '../../context/ThemeContext'
import { APP_VERSION } from '../../lib/app-version'
import { getTeamOverview, setMyAway, type PresenceStatus } from '../../lib/teams-api'
import { UserAvatar } from '../ui/UserAvatar'
import { PresenceDot } from '../ui/PresenceDot'
import { Tip } from '../ui/Tip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { useGatewayStatus } from './ConnectionStatus'
import { useGoToWorkspacesHub } from './SidebarWorkspaceSwitcher'

const PRESENCE_OPTIONS: Array<'available' | 'away'> = ['available', 'away']

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
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const { token, user, logout } = useAuth()
  const { mode, setMode } = useTheme()
  const status = useGatewayStatus()
  const goToWorkspacesHub = useGoToWorkspacesHub()
  const name = user?.name?.trim() || 'Account'
  const email = user?.email ?? ''
  const statusLabel = t(`gateway.${status}`)
  const [presence, setPresence] = useState<'available' | 'away'>('available')
  const [presenceBusy, setPresenceBusy] = useState(false)

  const loadPresence = useCallback(async () => {
    if (!token || !email) return
    try {
      const overview = await getTeamOverview(token)
      const me = overview.people.find((p) => p.email === email)
      const next = me?.presence.status
      if (next === 'available' || next === 'away') setPresence(next)
    } catch {
      // Keep last known value; menu still usable.
    }
  }, [token, email])

  useEffect(() => {
    void loadPresence()
  }, [loadPresence])

  const changePresence = async (next: 'available' | 'away') => {
    if (!token || presenceBusy || next === presence) return
    const previous = presence
    setPresence(next)
    setPresenceBusy(true)
    try {
      const result = await setMyAway(token, next === 'away')
      const nextStatus = result.status as PresenceStatus
      if (nextStatus === 'available' || nextStatus === 'away') setPresence(nextStatus)
    } catch (err) {
      setPresence(previous)
      toast.error(err instanceof Error ? err.message : t('topbar.presenceError'))
    } finally {
      setPresenceBusy(false)
    }
  }

  const go = (path: string) => {
    navigate(path)
    onNavigate?.()
  }

  const gatewayOk = status === 'connected'
  const gatewayTitle =
    status === 'disconnected'
      ? t('gateway.reconnectHint')
      : t('gateway.title', { status: statusLabel })

  const avatar = (
    <span className="relative shrink-0">
      <UserAvatar
        name={name}
        email={email}
        avatarUrl={user?.avatarUrl}
        size={collapsed ? 24 : 24}
        presence={presence}
      />
    </span>
  )

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void loadPresence()
      }}
    >
      <Tip label={collapsed ? name : undefined} side="right">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('topbar.openUserMenu')}
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
      </Tip>
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={presenceBusy || !token}>
            <span className="mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <PresenceDot status={presence} />
            </span>
            {tCommon(`presence.${presence}`)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36">
            {PRESENCE_OPTIONS.map((value) => {
              const selected = presence === value
              return (
                <DropdownMenuItem
                  key={value}
                  disabled={presenceBusy}
                  onSelect={(event) => {
                    event.preventDefault()
                    void changePresence(value)
                  }}
                  className={selected ? 'bg-bg-hover' : undefined}
                >
                  <PresenceDot status={value} className="mr-2" />
                  {tCommon(`presence.${value}`)}
                  {selected ? (
                    <Check size={14} className="ml-auto shrink-0 text-text-heading" aria-hidden />
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={logout}>
          <LogOut size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
          {t('topbar.signOut')}
        </DropdownMenuItem>
        <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1.5 text-2xs">
          {gatewayOk ? (
            <Tip label={gatewayTitle}>
              <span className="inline-flex items-center gap-1 text-text-muted">
                <Check size={11} strokeWidth={2.5} className="shrink-0 text-text-muted" aria-hidden />
                {statusLabel}
              </span>
            </Tip>
          ) : (
            <Tip label={gatewayTitle}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className={
                  status === 'disconnected'
                    ? 'inline-flex min-w-0 items-center gap-1 font-medium text-status-error hover:text-status-error/90'
                    : 'inline-flex min-w-0 items-center gap-1 font-medium text-status-warning hover:text-status-warning/90'
                }
              >
                <AlertCircle size={11} strokeWidth={2.5} className="shrink-0" aria-hidden />
                <span className="truncate-fade">{statusLabel}</span>
              </button>
            </Tip>
          )}
          <Tip label={`build ${APP_VERSION}`}>
            <span className="shrink-0 text-text-muted">v{APP_VERSION}</span>
          </Tip>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
