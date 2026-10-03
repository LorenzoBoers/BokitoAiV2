import { useTranslation } from 'react-i18next'
import { getInitials, getAvatarColor } from '../../lib/avatar'
import { cn } from '../../lib/utils'
import { Tip } from './Tip'

type Presence = 'available' | 'away' | 'offline'

const PRESENCE_DOT: Record<Presence, string> = {
  available: 'bg-status-success',
  away: 'bg-status-warning',
  offline: 'bg-text-muted/60',
}

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

function PresenceCorner({ presence, size }: { presence: Presence; size: number }) {
  const { t } = useTranslation('common')
  const label = t(`presence.${presence}`)
  const dot = Math.max(6, Math.round(size * 0.32))
  return (
    <Tip label={label}>
      <span
        style={{ width: dot, height: dot }}
        className={cn('absolute -bottom-px -right-px rounded-full ring-2 ring-bg-surface', PRESENCE_DOT[presence])}
      >
        <span className="sr-only">{label}</span>
      </span>
    </Tip>
  )
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
      <PresenceCorner presence={presence} size={size} />
    </span>
  )
}
