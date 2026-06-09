import { useEffect, useMemo, useState } from 'react'
import { UserRound } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { listInboxMembers, type InboxMember } from '../../lib/inbox-api'
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
  const { token } = useAuth()
  const [members, setMembers] = useState<InboxMember[]>([])

  useEffect(() => {
    if (!token) return
    listInboxMembers(token)
      .then(setMembers)
      .catch(() => {})
  }, [token])

  const currentMember = useMemo(
    () => members.find((m) => m.id === currentAssigneeId) ?? null,
    [members, currentAssigneeId],
  )

  const tooltip = currentMember ? `Toegewezen aan ${currentMember.name}` : 'Toewijzen'

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
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
          Toewijzen
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onChange(null)}
          className={cn('text-xs', currentAssigneeId == null && 'bg-bg-hover/80')}
        >
          Unassigned
        </DropdownMenuItem>
        {members.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => onChange(m.id)}
            className={cn('text-xs', currentAssigneeId === m.id && 'bg-bg-hover/80')}
          >
            {m.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
