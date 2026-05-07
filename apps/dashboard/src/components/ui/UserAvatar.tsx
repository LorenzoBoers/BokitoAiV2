import { getInitials, getAvatarColor } from '../../lib/avatar'

interface UserAvatarProps {
  name: string
  email: string
  avatarUrl?: string | null
  size?: number
  className?: string
}

export function UserAvatar({ name, email, avatarUrl, size = 32, className = '' }: UserAvatarProps) {
  const initials = getInitials(name)
  const { bg, text } = getAvatarColor(email)
  const fontSize = Math.round(size * 0.36)
  const borderRadius = Math.round(size * 0.3)

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{ width: size, height: size, borderRadius }}
        className={`object-cover shrink-0 ${className}`}
      />
    )
  }

  return (
    <span
      style={{ width: size, height: size, borderRadius, background: bg, color: text, fontSize }}
      className={`inline-flex items-center justify-center font-semibold shrink-0 select-none ${className}`}
    >
      {initials}
    </span>
  )
}
