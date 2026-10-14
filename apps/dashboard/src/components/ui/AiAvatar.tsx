import type { CSSProperties, ReactNode } from 'react'
import type { BotOrbMotion } from '../../lib/agentActivity'
import { getInitials } from '../../lib/avatar'
import {
  resolveAgentAvatarColor,
  resolveAgentAvatarIcon,
  resolveAgentAvatarShape,
  type AgentAvatarKind,
} from '../../lib/agent-avatar'
import type { AgentPresenceStatus } from '../../lib/teams-api'
import { cn } from '../../lib/utils'
import { BotOrbAvatar } from './BotOrbAvatar'
import { PresenceCorner } from './PresenceCorner'

interface AiAvatarProps {
  name?: string | null
  seed?: string
  size?: number
  className?: string
  kind?: AgentAvatarKind | string | null
  icon?: string | null
  /** Tint for orb marks. */
  color?: string | null
  /** Silhouette key for orb marks. */
  shape?: string | null
  imageUrl?: string | null
  /** Hide the name from assistive tech when a parent already labels the control. */
  decorative?: boolean
  /** Corner: static purple standby, pulsing purple working, red error. */
  activity?: AgentPresenceStatus | null
  /** Orb face mood (thinking / typing / working). Defaults from activity when omitted. */
  motion?: BotOrbMotion | null
  /** Freeze orb idle motion (facepiles, static previews). */
  paused?: boolean
}

function resolveKind(
  kind: string | null | undefined,
  icon: string | null | undefined,
  imageUrl: string | null | undefined,
): AgentAvatarKind {
  const normalized = (kind ?? '').trim().toLowerCase()
  if (normalized === 'image' && imageUrl) return 'image'
  if (normalized === 'orb') return 'orb'
  if (normalized === 'icon' && icon && resolveAgentAvatarIcon(icon)) return 'icon'
  if (normalized === 'initials') return 'initials'
  if (imageUrl) return 'image'
  if (icon && resolveAgentAvatarIcon(icon)) return 'icon'
  return 'initials'
}

function resolveOrbMotion(
  motion: BotOrbMotion | null | undefined,
  activity: AgentPresenceStatus | null | undefined,
): BotOrbMotion {
  if (motion) return motion
  if (activity === 'working') return 'working'
  return 'idle'
}

/**
 * Agent mark: initials / Lucide icon on the AI violet shell, tinted bot orb
 * (shape + color + mood), or an uploaded image.
 */
export function AiAvatar({
  name,
  seed: _seed,
  size = 32,
  className = '',
  kind,
  icon,
  color,
  shape,
  imageUrl,
  decorative = false,
  activity,
  motion,
  paused = false,
}: AiAvatarProps) {
  const displayName = name?.trim() || 'Agent'
  const initials = getInitials(displayName)
  const resolved = resolveKind(kind, icon, imageUrl)
  const Icon = resolved === 'icon' ? resolveAgentAvatarIcon(icon) : null
  const orbColor = resolveAgentAvatarColor(color)
  const orbShape = resolveAgentAvatarShape(shape)
  const orbMotion = resolveOrbMotion(motion, activity)
  const fontSize = Math.round(size * 0.36)
  const iconSize = Math.round(size * 0.5)
  const borderRadius = Math.round(size / 2)
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

  let face: ReactNode
  if (resolved === 'orb') {
    face = (
      <BotOrbAvatar
        color={orbColor}
        shape={orbShape}
        size={size}
        motion={orbMotion}
        paused={paused}
        className={cn(activity ? '' : className)}
        decorative={decorative}
        label={displayName}
      />
    )
  } else if (resolved === 'image' && imageUrl) {
    face = (
      <span
        style={style}
        className={cn('ai-avatar ai-avatar-image', activity ? '' : className)}
        data-working={working || undefined}
        {...a11yProps}
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
      </span>
    )
  } else {
    face = (
      <span
        style={style}
        className={cn('ai-avatar', activity ? '' : className)}
        data-working={working || undefined}
        {...a11yProps}
      >
        {Icon ? <Icon size={iconSize} strokeWidth={2} aria-hidden /> : initials}
      </span>
    )
  }

  if (!activity) return face
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {face}
      <PresenceCorner status={activity} size={size} />
    </span>
  )
}
