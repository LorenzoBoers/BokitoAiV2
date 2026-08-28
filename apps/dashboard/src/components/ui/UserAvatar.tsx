import { getInitials, getAvatarColor } from '../../lib/avatar'

interface UserAvatarProps {
  name: string
  email: string
  avatarUrl?: string | null
  size?: number
  className?: string
  /** Hide the name/initials from assistive tech when a parent already labels the control. */
  decorative?: boolean
}

export function UserAvatar({
  name,
  email,
  avatarUrl,
  size = 32,
  className = '',
  decorative = false,
}: UserAvatarProps) {
  const initials = getInitials(name)
  const { bg, text } = getAvatarColor(email)
  const fontSize = Math.round(size * 0.36)
  const borderRadius = Math.round(size / 2)

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={decorative ? '' : name}
        style={{ width: size, height: size, borderRadius }}
        className={`object-cover shrink-0 ${className}`}
      />
    )
  }

  return (
    <span
      aria-hidden={decorative || undefined}
      style={{ width: size, height: size, borderRadius, background: bg, color: text, fontSize }}
      className={`inline-flex items-center justify-center font-semibold leading-none shrink-0 select-none ${className}`}
    >
      {initials}
    </span>
  )
}
