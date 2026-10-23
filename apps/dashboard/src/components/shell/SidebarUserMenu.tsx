import { Pressable } from '../ui/pressable'
import { useCallback, useEffect, useState } from 'react'
import { Building2, Check, ChevronsUpDown, CircleHelp, LaptopMinimal, LogOut, Moon, Settings, Sun, UserCircle2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useTheme, type ThemeMode } from '../../context/ThemeContext'
import { useMembers } from '../../hooks/useMembers'
import { selfVisiblePresence } from '../../lib/presence'
import { getTeamOverview, setMyAvailability, type PresenceStatus } from '../../lib/teams-api'
import { Avatar } from '../ui/avatar'
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
import WorkspaceIdHint from './WorkspaceIdHint'
import { useGoToWorkspacesHub } from './SidebarWorkspaceSwitcher'

const PRESENCE_OPTIONS: Array<{
  presence: 'available' | 'away' | 'unavailable'
  mode: 'online' | 'away' | 'unavailable'
}> = [
  { presence: 'available', mode: 'online' },
  { presence: 'away', mode: 'away' },
  { presence: 'unavailable', mode: 'unavailable' },
]
type MenuPresence = 'available' | 'away' | 'unavailable' | 'offline'

function emailsMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

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
 * user menu upwards. Theme, presence and the support line live here.
 */
export default function SidebarUserMenu({ collapsed, onNavigate }: SidebarUserMenuProps) {
  const { t } = useTranslation('nav')
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const { token, user, logout } = useAuth()
  const { mode, setMode } = useTheme()
  const goToWorkspacesHub = useGoToWorkspacesHub()
  const name = user?.name?.trim() || 'Account'
  const email = user?.email ?? ''
  const [presence, setPresence] = useState<MenuPresence>('available')
  const [presenceBusy, setPresenceBusy] = useState(false)
  const { members } = useMembers()

  const loadPresence = useCallback(async () => {
    if (!token || !email) return
    if (members.some((person) => emailsMatch(person.email, email) && (person.presence === 'available' || person.presence === 'away' || person.presence === 'unavailable'))) {
      return
    }
    try {
      const overview = await getTeamOverview(token)
      const me = overview.people.find((p) => emailsMatch(p.email, email))
      const next = me?.presence.status
      if (next === 'available' || next === 'away' || next === 'unavailable' || next === 'offline') {
        setPresence(selfVisiblePresence(next))
      }
    } catch {
      // Keep last known value; menu still usable.
    }
  }, [token, email, members])

  useEffect(() => {
    const me = members.find((person) => emailsMatch(person.email, email))
    const next = me?.presence
    if (next === 'available' || next === 'away' || next === 'unavailable' || next === 'offline') {
      setPresence(selfVisiblePresence(next))
    }
  }, [members, email])

  useEffect(() => {
    void loadPresence()
  }, [loadPresence])

  const changePresence = async (next: (typeof PRESENCE_OPTIONS)[number]) => {
    if (!token || presenceBusy || next.presence === presence) return
    const previous = presence
    setPresence(next.presence)
    setPresenceBusy(true)
    try {
      const result = await setMyAvailability(token, next.mode)
      const nextStatus = result.status as PresenceStatus
      if (nextStatus === 'available' || nextStatus === 'away' || nextStatus === 'unavailable') setPresence(nextStatus)
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

  const avatar = (
    <span className="relative shrink-0">
      <Avatar
        kind="person"
        decorative={false}
        name={name}
        email={email}
        imageUrl={user?.avatarUrl}
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
          <Pressable
            aria-label={t('topbar.openUserMenu')}
            className={`w-auto flex items-center gap-2 rounded-md text-left transition-colors hover:bg-bg-hover data-[state=open]:bg-bg-hover ${
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
                <ChevronsUpDown size={14} className="shrink-0 text-text-muted" aria-hidden />
              </>
            )}
          </Pressable>
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
          {t('topbar.support')}
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
              const selected = presence === value.presence
              return (
                <DropdownMenuItem
                  key={value.presence}
                  disabled={presenceBusy}
                  onSelect={(event) => {
                    event.preventDefault()
                    void changePresence(value)
                  }}
                  className={selected ? 'bg-bg-hover' : undefined}
                >
                  <PresenceDot status={value.presence} className="mr-2" />
                  {tCommon(`presence.${value.presence}`)}
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
        <div
          className="px-2 pb-1 pt-1.5"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <WorkspaceIdHint liveMarker="check" />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
