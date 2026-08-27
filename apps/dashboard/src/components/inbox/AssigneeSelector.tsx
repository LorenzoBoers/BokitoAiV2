import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useMembers } from '../../hooks/useMembers'
import { UserAvatar } from '../ui/UserAvatar'
import { cn } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

type Props = {
  currentAssigneeId: number | null
  onChange: (userId: number | null) => void
  disabled?: boolean
}

export default function AssigneeSelector({ currentAssigneeId, onChange, disabled }: Props) {
  const { t } = useTranslation('communication')
  const { user } = useAuth()
  const { members } = useMembers()
  const myId =
    members.find((member) => member.email.toLowerCase() === (user?.email ?? '').toLowerCase())?.id ??
    user?.id ??
    null
  const assignedToMe = myId != null && myId !== 0 && currentAssigneeId === myId

  const currentMember = useMemo(
    () => members.find((m) => m.id === currentAssigneeId) ?? null,
    [members, currentAssigneeId],
  )

  const tooltip = currentMember
    ? t('threadChrome.assignedTo', { name: currentMember.name })
    : t('threadChrome.assign')

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              id="inbox-assignee-trigger"
              disabled={disabled}
              aria-label={tooltip}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors',
                'hover:bg-bg-hover hover:text-text-primary',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
                'disabled:pointer-events-none disabled:opacity-40',
                'data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary',
                currentMember && 'text-accent',
              )}
            >
              <UserRound size={14} strokeWidth={currentMember ? 2.25 : 1.75} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuLabel className="normal-case tracking-normal font-medium text-text-secondary">
          {t('threadChrome.assign')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {myId != null && !assignedToMe ? (
          <DropdownMenuItem
            onSelect={() => onChange(myId)}
            className="text-xs font-medium"
          >
            {t('threadChrome.assignToMe')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onSelect={() => onChange(null)}
          className={cn('text-xs', currentAssigneeId == null && 'bg-bg-hover/80')}
        >
          {t('threadChrome.unassigned')}
        </DropdownMenuItem>
        {members.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => onChange(m.id)}
            className={cn('gap-2 text-xs', currentAssigneeId === m.id && 'bg-bg-hover/80')}
          >
            <UserAvatar name={m.name} email={m.email} avatarUrl={m.avatarUrl} size={18} />
            {m.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
