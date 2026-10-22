import { useAgents } from '../../hooks/useAgents'
import { useMembers } from '../../hooks/useMembers'
import { resolveTeamStackMembers } from '../../lib/team-facepile'
import { toTeamAvatarProps } from '../../lib/team-avatar'
import type { PresenceStatus, TeamMemberRef } from '../../lib/teams-api'
import { AvatarStack } from './AvatarStack'
import { TeamAvatar } from './TeamAvatar'

type TeamSource = {
  id?: string | number | null
  name?: string | null
  members?: TeamMemberRef[]
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_image_url?: string | null
  avatarKind?: string | null
  avatarIcon?: string | null
  avatarColor?: string | null
  avatarImageUrl?: string | null
  presence?: { status?: PresenceStatus } | PresenceStatus | null
}

type Props = {
  team?: TeamSource | null
  /** Override member refs when the team row has no ``members`` yet. */
  members?: TeamMemberRef[]
  size?: number
  className?: string
  /** Menus and pickers should not navigate away on agent faces. */
  linkAgents?: boolean
  presence?: PresenceStatus
  /**
   * Cap the pile. The communication rail uses 2: a +N disc at 14px
   * paints over the department name.
   */
  faces?: number
  cutout?: 'surface' | 'bg'
}

/**
 * Team mark: overlapping member faces when known, otherwise initials / system icon.
 */
export function TeamFacepile({
  team,
  members,
  size = 18,
  className,
  linkAgents = false,
  presence,
  faces,
  cutout = 'surface',
}: Props) {
  const { members: people } = useMembers()
  const { agents } = useAgents()
  const refs = members ?? team?.members ?? []
  const stack = resolveTeamStackMembers(refs, {
    people: people.map((p) => ({
      uuid: p.uuid,
      id: p.id,
      name: p.name,
      email: p.email,
      avatarUrl: p.avatarUrl,
    })),
    agents,
  })
  const visible = faces != null && faces > 0 ? stack.slice(0, faces) : stack
  if (visible.length > 0) {
    return (
      <AvatarStack
        members={visible}
        size={size}
        className={className}
        linkAgents={linkAgents}
        cutout={cutout}
      />
    )
  }
  const teamPresence =
    presence ??
    (typeof team?.presence === 'string' ? team.presence : team?.presence?.status)
  return (
    <TeamAvatar
      {...toTeamAvatarProps(team)}
      size={size}
      decorative
      presence={teamPresence}
      className={className}
    />
  )
}
