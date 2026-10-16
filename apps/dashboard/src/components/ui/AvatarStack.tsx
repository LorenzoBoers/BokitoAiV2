import { Link } from 'react-router-dom'
import type { AgentAvatarSource } from '../../lib/agent-avatar'
import { openEntityPath } from '../../lib/open-entity'
import { cn } from '../../lib/utils'
import { AgentMark } from './AgentMark'
import { UserAvatar } from './UserAvatar'

/** Faces shown before the overflow chip. */
export const AVATAR_STACK_MAX = 3

/** Horizontal pull so faces overlap past the cutout ring. */
const STACK_OVERLAP_PX = 12

export type AvatarStackUser = {
  key: string
  kind: 'user'
  name: string
  email: string
  avatarUrl?: string | null
}

export type AvatarStackAgent = {
  key: string
  kind: 'agent'
  name: string
  id: string
  /** Full agent row — pass through so orb shape/color are not dropped. */
  agent: AgentAvatarSource
}

export type AvatarStackMember = AvatarStackUser | AvatarStackAgent

type Props = {
  members: AvatarStackMember[]
  size?: number
  className?: string
  /** When false (menus/pickers), agent faces are not links. */
  linkAgents?: boolean
}

/**
 * Overlapping facepile for people and agents: up to three faces, then a
 * fourth slot with +N when there are more. Agents use AgentMark unclipped
 * with a silhouette surface outline (same cutout role as the people ring).
 * People stay circular with a surface ring. Agent faces link to the agent page
 * unless ``linkAgents`` is false.
 */
export function AvatarStack({ members, size = 32, className, linkAgents = true }: Props) {
  if (members.length === 0) return null
  const shown = members.slice(0, AVATAR_STACK_MAX)
  const overflow = members.length - shown.length
  const overlap = Math.max(6, Math.min(STACK_OVERLAP_PX, Math.round(size * 0.4)))

  return (
    <span
      className={cn('inline-flex items-center overflow-visible', className)}
      data-testid="avatar-stack"
    >
      {shown.map((member, index) => {
        const style = {
          zIndex: shown.length - index,
          marginLeft: index > 0 ? -overlap : 0,
        } as const

        if (member.kind === 'agent') {
          const mark = (
            <AgentMark
              agent={member.agent}
              size={size}
              mode="static"
              stackOutline
              decorative
            />
          )
          if (!linkAgents) {
            return (
              <span
                key={member.key}
                className="relative inline-flex shrink-0 overflow-visible"
                style={style}
                title={member.name}
                aria-hidden
                data-testid="avatar-stack-agent"
              >
                {mark}
              </span>
            )
          }
          return (
            <Link
              key={member.key}
              to={openEntityPath({ type: 'agent', id: member.id })}
              className="relative inline-flex shrink-0 overflow-visible transition hover:z-20"
              style={style}
              title={member.name}
              aria-label={member.name}
              data-testid="avatar-stack-agent"
            >
              {mark}
            </Link>
          )
        }

        return (
          <span
            key={member.key}
            className="relative inline-flex shrink-0 overflow-hidden rounded-full ring-2 ring-bg-surface"
            style={style}
            title={member.name}
            aria-hidden
            data-testid="avatar-stack-user"
          >
            <UserAvatar
              name={member.name}
              email={member.email}
              avatarUrl={member.avatarUrl}
              size={size}
              decorative
            />
          </span>
        )
      })}
      {overflow > 0 ? (
        <span
          className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-bg-elevated text-2xs font-medium tabular-nums text-text-muted ring-2 ring-bg-surface"
          style={{
            width: size,
            height: size,
            zIndex: 0,
            marginLeft: -overlap,
          }}
          title={`+${overflow}`}
          aria-label={`+${overflow}`}
          data-testid="avatar-stack-overflow"
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  )
}
