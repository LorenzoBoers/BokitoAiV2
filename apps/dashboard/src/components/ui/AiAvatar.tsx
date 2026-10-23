import type { CSSProperties, ReactNode } from 'react'
import type { BotOrbMotion } from '../../lib/bot-orb-motion'
import { getInitials } from '../../lib/avatar'
import {
  resolveAgentAvatarColor,
  resolveAgentAvatarIcon,
  resolveAgentAvatarShape,
  type AgentAvatarKind,
} from '../../lib/agent-avatar'
import type { AgentPresenceStatus } from '../../lib/teams-api'
import { snapMarkSize } from '../../lib/mark-scale'
import { cn } from '../../lib/utils'
import { BotOrbAvatar, type BotOrbMode } from './BotOrbAvatar'
import { PresenceCorner } from './PresenceCorner'

export type AiAvatarMode = BotOrbMode

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
  /** Orb face mood (thinking / typing / working / one-shots). Defaults from activity when omitted. */
  motion?: BotOrbMotion | null
  /** Replay one-shot when this changes. */
  pulseId?: string | null
  /** Loop to return to after a one-shot. */
  baseMotion?: BotOrbMotion | null
  /** Canonical presentation: live animates; static freezes (footprints / lists). */
  mode?: AiAvatarMode
  /**
   * Alias for `mode="static"`. Prefer `mode`.
   * @deprecated Use `mode="static"`.
   */
  paused?: boolean
  /** Spawn entrance key while live (changes trigger the effect). */
  spawnKey?: string | null
  /** Silhouette outline for overlapping facepiles (orbs). */
  stackOutline?: boolean
}

type ResolvedMark = AgentAvatarKind | 'pending'

function resolveKind(
  kind: string | null | undefined,
  icon: string | null | undefined,
  imageUrl: string | null | undefined,
): ResolvedMark {
  const normalized = (kind ?? '').trim().toLowerCase()
  if (normalized === 'image' && imageUrl) return 'image'
  if (normalized === 'orb') return 'orb'
  if (normalized === 'icon' && icon && resolveAgentAvatarIcon(icon)) return 'icon'
  if (normalized === 'initials') return 'initials'
  if (normalized === 'image' || normalized === 'icon' || normalized === 'pending') {
    // Known kind but payload still loading (no icon/url yet): empty tinted circle.
    return 'pending'
  }
  if (imageUrl) return 'image'
  // No kind (or unknown): product default is the bot orb. Do not infer Lucide
  // from a leftover avatar_icon — that drops shape/color on pickers and @mentions.
  if (!normalized) return 'orb'
  if (icon && resolveAgentAvatarIcon(icon)) return 'icon'
  return 'orb'
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
  pulseId = null,
  baseMotion = null,
  mode,
  paused = false,
  spawnKey = null,
  stackOutline = false,
}: AiAvatarProps) {
  const displayName = name?.trim() || 'Agent'
  const box = snapMarkSize(size)
  const initials = getInitials(displayName)
  const resolved = resolveKind(kind, icon, imageUrl)
  const Icon = resolved === 'icon' ? resolveAgentAvatarIcon(icon) : null
  const orbColor = resolveAgentAvatarColor(color)
  const orbShape = resolveAgentAvatarShape(shape)
  const orbMotion = resolveOrbMotion(motion, activity)
  const fontSize = Math.round(box * 0.36)
  const iconSize = Math.round(box * 0.5)
  const borderRadius = Math.round(box / 2)
  const halo = Math.max(2, Math.round(box * 0.1))
  const style = {
    width: box,
    height: box,
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
        size={box}
        motion={orbMotion}
        pulseId={pulseId}
        baseMotion={baseMotion ?? (activity === 'working' ? 'working' : 'idle')}
        mode={mode}
        paused={paused}
        spawnKey={spawnKey}
        stackOutline={stackOutline}
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
  } else if (resolved === 'pending') {
    // Quick-load shell: translucent grey skeleton circle, not the default orb.
    face = (
      <span
        style={style}
        className={cn('ai-avatar-pending skeleton-shimmer', activity ? '' : className)}
        data-testid="ai-avatar-pending"
        {...a11yProps}
      />
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
      <PresenceCorner status={activity} size={box} />
    </span>
  )
}
