import type { TeamAvatarKind } from '../../lib/team-avatar'
import type { PresenceStatus } from '../../lib/teams-api'
import { Avatar } from './avatar'

interface TeamAvatarProps {
  name?: string | null
  seed?: string
  size?: number
  className?: string
  kind?: TeamAvatarKind | string | null
  icon?: string | null
  color?: string | null
  imageUrl?: string | null
  decorative?: boolean
  presence?: PresenceStatus
}

/** @deprecated Use `<Avatar kind="team">`. */
export function TeamAvatar({ name, seed, size = 32, className, kind, icon, color, imageUrl, decorative = false, presence }: TeamAvatarProps) {
  return (
    <Avatar
      kind="team"
      team={{ name, seed, avatar_kind: kind, avatar_icon: icon, avatar_color: color, avatar_image_url: imageUrl }}
      size={size}
      className={className}
      decorative={decorative}
      presence={presence}
    />
  )
}
