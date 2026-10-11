import type { CSSProperties } from 'react'
import { getInitials } from '../../lib/avatar'
import { resolveAgentAvatarIcon, type AgentAvatarKind } from '../../lib/agent-avatar'
import type { AgentPresenceStatus } from '../../lib/teams-api'
import { cn } from '../../lib/utils'
import { PresenceCorner } from './PresenceCorner'

interface AiAvatarProps {
  name?: string | null
  seed?: string
  size?: number
  className?: string
  kind?: AgentAvatarKind | string | null
  icon?: string | null
  /** Ignored — agents always use the platform AI violet. Kept for call-site compat. */
  color?: string | null
  imageUrl?: string | null
  /** Hide the name from assistive tech when a parent already labels the control. */
  decorative?: boolean
  /** Corner: static purple standby, pulsing purple working, red error. */
  activity?: AgentPresenceStatus | null
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
 * Agent mark. A round disc like people avatars, but inverted: a violet tint
 * of the surface with a crisp violet ring and a violet glyph, plus a faint
 * glow (`.ai-avatar`, see index.css). Images keep the ring. Optional
 * activity corner for standby / working / error; while working a violet
 * streak orbits the ring.
 */
export function AiAvatar({
  name,
  seed: _seed,
  size = 32,
  className = '',
  kind,
  icon,
  color: _color,
  imageUrl,
  decorative = false,
  activity,
}: AiAvatarProps) {
  const displayName = name?.trim() || 'Agent'
  const initials = getInitials(displayName)
  const resolved = resolveKind(kind, icon, imageUrl)
  const Icon = resolved === 'icon' ? resolveAgentAvatarIcon(icon) : null
  const fontSize = Math.round(size * 0.36)
  const iconSize = Math.round(size * 0.5)
  const borderRadius = Math.round(size / 2)
  // Glow reach scales with the mark: 2px at 14, 3px at 28, 4px at 40.
  const halo = Math.max(2, Math.round(size * 0.1))
  const style = {
    width: size,
    height: size,
    borderRadius,
    fontSize,
    '--ai-halo': `${halo}px`,
  } as CSSProperties
  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : { 'aria-label': displayName, title: displayName }
  const working = activity === 'working'

  const face =
    resolved === 'image' && imageUrl ? (
      <span
        style={style}
        className={cn('ai-avatar ai-avatar-image', activity ? '' : className)}
        data-working={working || undefined}
        {...a11yProps}
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
      </span>
    ) : (
      <span
        style={style}
        className={cn('ai-avatar', activity ? '' : className)}
        data-working={working || undefined}
        {...a11yProps}
      >
        {Icon ? <Icon size={iconSize} strokeWidth={2} aria-hidden /> : initials}
      </span>
    )

  if (!activity) return face
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {face}
      <PresenceCorner status={activity} size={size} />
    </span>
  )
}
