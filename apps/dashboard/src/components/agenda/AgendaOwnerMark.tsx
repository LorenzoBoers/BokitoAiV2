import { Users } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import type { AgendaOwner } from '../../lib/agenda-layout'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { toTeamAvatarProps } from '../../lib/team-avatar'
import { AiAvatar } from '../ui/AiAvatar'
import { TeamAvatar } from '../ui/TeamAvatar'
import { UserAvatar } from '../ui/UserAvatar'
import { cn } from '../../lib/utils'

/** Face for a person, team or agent so Agenda items show who at a glance. */
export function AgendaOwnerMark({
  owner,
  size = 16,
  withName = false,
  className,
}: {
  owner: AgendaOwner
  size?: number
  withName?: boolean
  className?: string
}) {
  const { user } = useAuth()
  const { members } = useMembers()
  const { teams } = useTeams()
  const { agents } = useAgents()
  const name = owner.name || (owner.kind === 'team' ? 'Team' : owner.kind === 'agent' ? 'Agent' : '')
  const mark =
    owner.kind === 'agent' ? (
      <AiAvatar
        {...toAiAvatarProps(
          agents.find((row) => row.id === owner.id) ?? { id: owner.id, name },
          name || 'Agent',
        )}
        size={size}
        decorative
      />
    ) : owner.kind === 'team' ? (
      <TeamAvatar
        {...toTeamAvatarProps(
          teams.find((row) => row.id === owner.id) ?? { id: owner.id, name },
        )}
        size={size}
        decorative
      />
    ) : (() => {
      const member = owner.id ? members.find((row) => row.uuid === owner.id) : undefined
      const self = owner.id && user?.uuid === owner.id ? user : undefined
      const faceName = member?.name || self?.name || name
      const email = member?.email || self?.email || faceName
      const avatarUrl = member?.avatarUrl ?? self?.avatarUrl ?? null
      return faceName ? (
        <UserAvatar name={faceName} email={email} avatarUrl={avatarUrl} size={size} decorative />
      ) : (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-bg-elevated text-text-muted"
          style={{ width: size, height: size }}
          aria-hidden
        >
          <Users size={Math.max(10, Math.round(size * 0.6))} />
        </span>
      )
    })()
  if (!withName || !name) {
    return <span className={cn('inline-flex shrink-0', className)}>{mark}</span>
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      {mark}
      <span className="truncate">{name}</span>
    </span>
  )
}
