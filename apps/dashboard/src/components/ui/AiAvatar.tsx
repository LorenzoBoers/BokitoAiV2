import { getInitials } from '../../lib/avatar'
import {
  DEFAULT_AGENT_AVATAR_COLOR,
  resolveAgentAvatarIcon,
  type AgentAvatarKind,
} from '../../lib/agent-avatar'

interface AiAvatarProps {
  name?: string | null
  seed?: string
  size?: number
  className?: string
  kind?: AgentAvatarKind | string | null
  icon?: string | null
  color?: string | null
  imageUrl?: string | null
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

function resolveKind(
  kind: string | null | undefined,
  icon: string | null | undefined,
  imageUrl: string | null | undefined,
): AgentAvatarKind {
  const normalized = (kind ?? '').trim().toLowerCase()
  if (normalized === 'image' && imageUrl) return 'image'
  if (normalized === 'icon' && icon && resolveAgentAvatarIcon(icon)) return 'icon'
  if (normalized === 'initials') return 'initials'
  if (imageUrl) return 'image'
  if (icon && resolveAgentAvatarIcon(icon)) return 'icon'
  return 'initials'
}

/**
 * AI avatar style: image, Lucide icon, or tinted initials with border glow.
 * Distinguishes agents from human user avatars.
 */
export function AiAvatar({
  name,
  seed: _seed,
  size = 32,
  className = '',
  kind,
  icon,
  color,
  imageUrl,
}: AiAvatarProps) {
  const displayName = name?.trim() || 'Agent'
  const initials = getInitials(displayName)
  // Prefer explicit color, else platform AI violet (not per-name seed hues).
  const accent = (color?.trim() || DEFAULT_AGENT_AVATAR_COLOR).toLowerCase()
  const resolved = resolveKind(kind, icon, imageUrl)
  const Icon = resolved === 'icon' ? resolveAgentAvatarIcon(icon) : null
  const fontSize = Math.round(size * 0.36)
  const iconSize = Math.round(size * 0.48)
  const borderRadius = Math.round(size * 0.5)

  if (resolved === 'image' && imageUrl) {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius,
          border: `1px solid ${hexToRgba(accent, 0.55)}`,
          boxShadow: `0 0 0 2px ${hexToRgba(accent, 0.16)}, 0 0 12px ${hexToRgba(accent, 0.22)}`,
        }}
        className={`inline-flex shrink-0 overflow-hidden ${className}`}
        aria-label={displayName}
        title={displayName}
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
      </span>
    )
  }

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
      aria-label={displayName}
      title={displayName}
    >
      {Icon ? <Icon size={iconSize} strokeWidth={1.75} aria-hidden /> : initials}
    </span>
  )
}
