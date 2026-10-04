import { getInitials, getAvatarColor } from '../../lib/avatar'
import { cn } from '../../lib/utils'
import { PresenceCorner } from './PresenceCorner'

type Presence = 'available' | 'away' | 'offline'

interface UserAvatarProps {
  name: string
  email: string
  avatarUrl?: string | null
  size?: number
  className?: string
  /** Hide the name/initials from assistive tech when a parent already labels the control. */
  decorative?: boolean
  /** Availability dot in the corner. */
  presence?: Presence
}

export function UserAvatar({
  name,
  email,
  avatarUrl,
  size = 32,
  className = '',
  decorative = false,
  presence,
}: UserAvatarProps) {
  const initials = getInitials(name)
  const { bg, text } = getAvatarColor(email)
  const fontSize = Math.round(size * 0.36)
  const borderRadius = Math.round(size / 2)

  const face = avatarUrl ? (
    <img
      src={avatarUrl}
      alt={decorative ? '' : name}
      style={{ width: size, height: size, borderRadius }}
      className={`object-cover shrink-0 ${presence ? '' : className}`}
    />
  ) : (
    <span
      aria-hidden={decorative || undefined}
      style={{ width: size, height: size, borderRadius, background: bg, color: text, fontSize }}
      className={`inline-flex items-center justify-center font-semibold leading-none shrink-0 select-none ${presence ? '' : className}`}
    >
      {initials}
    </span>
  )

  if (!presence) return face
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {face}
      <PresenceCorner status={presence} size={size} />
    </span>
  )
}
