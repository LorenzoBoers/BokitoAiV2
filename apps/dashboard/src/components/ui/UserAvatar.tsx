import { getInitials, getAvatarColor } from '../../lib/avatar'
import { cn } from '../../lib/utils'
import { AvatarDisc } from './AvatarDisc'
import { PresenceCorner } from './PresenceCorner'
import type { PresenceStatus } from '../../lib/teams-api'

interface UserAvatarProps {
  name: string
  email: string
  avatarUrl?: string | null
  size?: number
  className?: string
  /** Hide the name/initials from assistive tech when a parent already labels the control. */
  decorative?: boolean
  /** Availability dot in the corner. */
  presence?: PresenceStatus
}

/** Workspace member face: photo or colored initials, optional presence corner. */
export function UserAvatar({
  name,
  email,
  avatarUrl,
  size = 32,
  className,
  decorative = false,
  presence,
}: UserAvatarProps) {
  const face = (
    <AvatarDisc
      size={size}
      imageUrl={avatarUrl}
      alt={name}
      colors={getAvatarColor(email)}
      decorative={decorative}
      className={presence ? undefined : className}
    >
      {getInitials(name)}
    </AvatarDisc>
  )

  if (!presence) return face
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {face}
      <PresenceCorner status={presence} size={size} />
    </span>
  )
}
