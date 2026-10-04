import { getInitials, getAvatarColor } from '../../lib/avatar'
import { resolveTeamAvatarIcon, type TeamAvatarKind } from '../../lib/team-avatar'
import type { PresenceStatus } from '../../lib/teams-api'
import { cn } from '../../lib/utils'
import { PresenceCorner } from './PresenceCorner'

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

function resolveKind(
  kind: string | null | undefined,
  icon: string | null | undefined,
  imageUrl: string | null | undefined,
): TeamAvatarKind {
  const normalized = (kind ?? '').trim().toLowerCase()
  if (normalized === 'image' && imageUrl) return 'image'
  if (normalized === 'icon' && icon && resolveTeamAvatarIcon(icon)) return 'icon'
  if (normalized === 'initials') return 'initials'
  if (imageUrl) return 'image'
  if (icon && resolveTeamAvatarIcon(icon)) return 'icon'
  return 'initials'
}

/**
 * Team mark: image, Lucide icon, or initials (default) with seeded color.
 * Optional presence corner — people green/amber/gray or agent purple standby/working.
 */
export function TeamAvatar({
  name,
  seed,
  size = 32,
  className = '',
  kind,
  icon,
  color,
  imageUrl,
  decorative = false,
  presence,
}: TeamAvatarProps) {
  const displayName = name?.trim() || 'Team'
  const initials = getInitials(displayName)
  const resolved = resolveKind(kind, icon, imageUrl)
  const Icon = resolved === 'icon' ? resolveTeamAvatarIcon(icon) : null
  const palette = getAvatarColor(seed || displayName)
  const bg = color?.trim() || palette.bg
  const fontSize = Math.round(size * 0.36)
  const iconSize = Math.round(size * 0.48)
  const borderRadius = Math.round(size * 0.5)
  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : { 'aria-label': displayName, title: displayName }

  const face =
    resolved === 'image' && imageUrl ? (
      <span
        style={{ width: size, height: size, borderRadius }}
        className={cn('inline-flex shrink-0 overflow-hidden border border-border/50', presence ? '' : className)}
        {...a11yProps}
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
      </span>
    ) : (
      <span
        style={{
          width: size,
          height: size,
          borderRadius,
          fontSize,
          background: bg,
          color: '#ffffff',
        }}
        className={cn(
          'inline-flex shrink-0 select-none items-center justify-center font-semibold leading-none',
          presence ? '' : className,
        )}
        {...a11yProps}
      >
        {Icon ? <Icon size={iconSize} strokeWidth={1.75} aria-hidden /> : initials}
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
