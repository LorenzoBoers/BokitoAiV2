import { getAvatarColor, getInitials } from '../../lib/avatar'

interface AiAvatarProps {
  name: string
  seed?: string
  size?: number
  className?: string
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * AI avatar style: transparent/tinted fill with colored letters + border glow.
 * This visually distinguishes agents from human user avatars.
 */
export function AiAvatar({ name, seed, size = 32, className = '' }: AiAvatarProps) {
  const initials = getInitials(name)
  const { bg: accent } = getAvatarColor(seed ?? name)
  const fontSize = Math.round(size * 0.36)
  const borderRadius = Math.round(size * 0.5)

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius,
        color: accent,
        fontSize,
        background: hexToRgba(accent, 0.08),
        border: `1px solid ${hexToRgba(accent, 0.55)}`,
        boxShadow: `0 0 0 2px ${hexToRgba(accent, 0.16)}, 0 0 12px ${hexToRgba(accent, 0.22)}`,
      }}
      className={`inline-flex shrink-0 select-none items-center justify-center font-semibold ${className}`}
      aria-label={name}
      title={name}
    >
      {initials}
    </span>
  )
}
