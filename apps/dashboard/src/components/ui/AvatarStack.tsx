import { Link } from 'react-router-dom'
import type { AgentAvatarSource } from '../../lib/agent-avatar'
import { toTeamAvatarProps } from '../../lib/team-avatar'
import { openEntityPath } from '../../lib/open-entity'
import { cn } from '../../lib/utils'
import { AgentMark } from './AgentMark'
import { TeamAvatar } from './TeamAvatar'
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
  /** Tooltip when it should say more than the name (owner, floor). */
  title?: string
}

export type AvatarStackAgent = {
  key: string
  kind: 'agent'
  name: string
  id: string
  /** Full agent row — pass through so orb shape/color are not dropped. */
  agent: AgentAvatarSource
  title?: string
}

/** Empty-team fallback inside a pile. A team with members expands to faces instead. */
export type AvatarStackTeam = {
  key: string
  kind: 'team'
  name: string
  team: Parameters<typeof toTeamAvatarProps>[0]
  title?: string
}

export type AvatarStackMember = AvatarStackUser | AvatarStackAgent | AvatarStackTeam

type Props = {
  members: AvatarStackMember[]
  size?: number
  className?: string
  /** When false (menus/pickers), agent faces are not links. */
  linkAgents?: boolean
  /** Member key that wears the accent cutout (thread floor). */
  activeKey?: string | null
  /** Faces before the +N chip. Defaults to three, same as workforce teams. */
  max?: number
  /**
   * Color of the overlap cutout. `surface` matches cards; `bg` matches the
   * thread header (`bg-bg`).
   */
  cutout?: 'surface' | 'bg'
}

/**
 * Overlapping facepile for people and agents: up to three faces, then a
 * fourth slot with +N when there are more. Agents use AgentMark unclipped
 * with a silhouette surface outline (same cutout role as the people ring).
 * People stay circular with a surface ring. Agent faces link to the agent page
 * unless ``linkAgents`` is false.
 */
export function AvatarStack({
  members,
  size = 32,
  className,
  linkAgents = true,
  activeKey = null,
  max = AVATAR_STACK_MAX,
  cutout = 'surface',
}: Props) {
  if (members.length === 0) return null
  const shown = members.slice(0, max)
  const overflow = members.length - shown.length
  const overlap = Math.max(6, Math.min(STACK_OVERLAP_PX, Math.round(size * 0.4)))
  const ring = 'ring-cutout'

  return (
    <span
      className={cn('inline-flex items-center overflow-visible', cutout === 'bg' && 'cutout-bg', className)}
      data-testid="avatar-stack"
    >
      {shown.map((member, index) => {
        const active = Boolean(activeKey && member.key === activeKey)
        const style = {
          zIndex: active ? 30 : shown.length - index,
          marginLeft: index > 0 ? -overlap : 0,
        } as const
        const tip = member.title || member.name

        if (member.kind === 'agent') {
          const mark = (
            <AgentMark
              agent={member.agent}
              size={size}
              mode="static"
              stackOutline
              decorative
              className={cn(cutout === 'bg' && 'bot-orb--on-bg', active && 'bot-orb--floor')}
            />
          )
          if (!linkAgents) {
            return (
              <span
                key={member.key}
                className="relative inline-flex shrink-0 overflow-visible"
                style={style}
                title={tip}
                aria-hidden
                data-testid="avatar-stack-agent"
                data-active={active || undefined}
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
              title={tip}
              aria-label={member.name}
              data-testid="avatar-stack-agent"
              data-active={active || undefined}
            >
              {mark}
            </Link>
          )
        }

        if (member.kind === 'team') {
          return (
            <span
              key={member.key}
              className={cn(
                'relative inline-flex shrink-0 overflow-hidden rounded-full ring-2',
                active ? 'ring-accent' : ring,
              )}
              style={style}
              title={tip}
              aria-hidden
              data-testid="avatar-stack-team"
              data-active={active || undefined}
            >
              <TeamAvatar {...toTeamAvatarProps(member.team, member.name)} size={size} decorative />
            </span>
          )
        }

        return (
          <span
            key={member.key}
            className={cn(
              'relative inline-flex shrink-0 overflow-hidden rounded-full ring-2',
              active ? 'ring-accent' : ring,
            )}
            style={style}
            title={tip}
            aria-hidden
            data-testid="avatar-stack-user"
            data-active={active || undefined}
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
          className={cn(
            'relative inline-flex shrink-0 items-center justify-center rounded-full bg-bg-elevated text-2xs font-medium tabular-nums text-text-muted ring-2',
            ring,
          )}
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
