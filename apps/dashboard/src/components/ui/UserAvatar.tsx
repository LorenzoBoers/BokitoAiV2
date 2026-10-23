import type { PresenceStatus } from '../../lib/teams-api'
import { Avatar } from './avatar'

interface UserAvatarProps {
  name: string
  email: string
  avatarUrl?: string | null
  size?: number
  className?: string
  decorative?: boolean
  presence?: PresenceStatus
}

/** @deprecated Use `<Avatar kind="person">`. */
export function UserAvatar({ name, email, avatarUrl, size = 32, className, decorative = false, presence }: UserAvatarProps) {
  return (
    <Avatar
      kind="person"
      name={name}
      email={email}
      imageUrl={avatarUrl}
      size={size}
      className={className}
      decorative={decorative}
      presence={presence}
    />
  )
}
