import { AgentMark } from './AgentMark'
import { TeamAvatar } from './TeamAvatar'
import { UserAvatar } from './UserAvatar'
import { toTeamAvatarProps } from '../../lib/team-avatar'

/** Minimal shape shared by thread participants and similar roster rows. */
export type ParticipantMarkSource = {
  kind: string
  ref_id?: string
  id?: string
  name?: string | null
  email?: string | null
  avatar_url?: string | null
  avatarUrl?: string | null
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_shape?: string | null
  avatar_image_url?: string | null
}

type Props = {
  participant: ParticipantMarkSource
  size?: number
  decorative?: boolean
}

/**
 * Central face for a conversation participant.
 * Agents → AgentMark, teams → TeamAvatar, people/contacts → UserAvatar.
 */
export function ParticipantMark({ participant, size = 18, decorative = true }: Props) {
  const name = (participant.name || '').trim() || participant.kind
  const kind = (participant.kind || '').trim().toLowerCase()

  if (kind === 'agent') {
    return (
      <AgentMark
        agent={participant}
        fallbackName={name}
        size={size}
        mode="static"
        decorative={decorative}
      />
    )
  }

  if (kind === 'team') {
    return (
      <TeamAvatar
        {...toTeamAvatarProps(participant, name)}
        size={size}
        decorative={decorative}
      />
    )
  }

  const email = (participant.email || '').trim() || name
  const avatarUrl = participant.avatarUrl ?? participant.avatar_url ?? null
  return (
    <UserAvatar
      name={name}
      email={email}
      avatarUrl={avatarUrl}
      size={size}
      decorative={decorative}
    />
  )
}
