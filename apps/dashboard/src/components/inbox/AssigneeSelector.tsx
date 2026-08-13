import { useMemo } from 'react'
import { UserRound } from 'lucide-react'
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
  const { members } = useMembers()

  const currentMember = useMemo(
    () => members.find((m) => m.id === currentAssigneeId) ?? null,
    [members, currentAssigneeId],
  )

  const tooltip = currentMember ? `Assigned to ${currentMember.name}` : 'Assign'

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
          Assign
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
