import type { LucideIcon } from 'lucide-react'
import {
  DEFAULT_BOT_ORB_COLOR,
  DEFAULT_BOT_ORB_SHAPE,
  resolveBotOrbColor,
  resolveBotOrbShape,
  type BotOrbShapeKey,
} from './bot-orb-shapes'
import { platformIcon, platformIconIds } from './platform-icons'

/** Full Lucide kebab set for pickers; resolve via platformIcon. */
export const AGENT_AVATAR_ICON_KEYS = platformIconIds()

export type AgentAvatarIconKey = string

/** @deprecated Prefer platformIcon / resolveAgentAvatarIcon. */
export const AGENT_AVATAR_ICONS: Record<string, LucideIcon> = new Proxy(
  {} as Record<string, LucideIcon>,
  {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      return platformIcon(prop) ?? undefined
    },
    has(_target, prop) {
      return typeof prop === 'string' && platformIcon(prop) != null
    },
  },
)

export {
  BOT_ORB_COLORS as AGENT_AVATAR_COLORS,
  BOT_ORB_SHAPE_KEYS as AGENT_AVATAR_SHAPE_KEYS,
  DEFAULT_BOT_ORB_COLOR as DEFAULT_AGENT_AVATAR_COLOR,
  DEFAULT_BOT_ORB_SHAPE as DEFAULT_AGENT_AVATAR_SHAPE,
  resolveBotOrbColor as resolveAgentAvatarColor,
  resolveBotOrbShape as resolveAgentAvatarShape,
} from './bot-orb-shapes'

/** Lift near-black orb colors so job-title text stays readable on dark surfaces. */
export function agentProfileAccentColor(hex: string): string {
  const raw = hex.trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(raw)) return hex
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (lum >= 0.32) return `#${raw}`
  const lift = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.48))
  const to = (n: number) => n.toString(16).padStart(2, '0')
  return `#${to(lift(r))}${to(lift(g))}${to(lift(b))}`
}

export type AgentAvatarKind = 'initials' | 'icon' | 'orb' | 'image'

/** Fields every surface needs to render the same agent mark. */
export type AgentAvatarProps = {
  name?: string | null
  seed?: string
  kind?: AgentAvatarKind | string | null
  icon?: string | null
  color?: string | null
  shape?: string | null
  imageUrl?: string | null
}

/**
 * Any agent-shaped payload from the API (snake_case), thread DTO (agentAvatar*),
 * or camelCase list rows. Prefer passing the whole object into `toAiAvatarProps`
 * / `AgentMark` instead of hand-picking fields (shape/color get dropped easily).
 */
export type AgentAvatarSource = {
  name?: string | null
  id?: string | number | null
  seed?: string | null
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_image_url?: string | null
  avatar_color?: string | null
  avatar_shape?: string | null
  /** camelCase variants (ownership picker, mentions, proposal items). */
  avatarKind?: string | null
  avatarIcon?: string | null
  avatarImageUrl?: string | null
  avatarColor?: string | null
  avatarShape?: string | null
  /** Thread / signal camelCase. */
  agentAvatarKind?: string | null
  agentAvatarIcon?: string | null
  agentAvatarImageUrl?: string | null
  agentAvatarColor?: string | null
  agentAvatarShape?: string | null
  agentName?: string | null
  agentId?: string | null
}

export function resolveAgentAvatarIcon(key: string | null | undefined): LucideIcon | null {
  return platformIcon(key)
}

/**
 * Single normalizer for agent marks. Always use this (or `AgentMark`) so orb
 * shape + color are not dropped when wiring a new surface.
 */
export function toAiAvatarProps(
  source: AgentAvatarSource | null | undefined,
  fallbackName = 'Agent',
): AgentAvatarProps {
  if (!source) {
    // Grey skeleton circle until agents/thread hydrate — not the default orb.
    return {
      name: fallbackName,
      kind: 'pending',
    }
  }
  const kind =
    source.avatar_kind ?? source.avatarKind ?? source.agentAvatarKind
  const shapeRaw =
    source.avatar_shape ?? source.avatarShape ?? source.agentAvatarShape
  const colorRaw =
    source.avatar_color ?? source.avatarColor ?? source.agentAvatarColor
  const icon = source.avatar_icon ?? source.avatarIcon ?? source.agentAvatarIcon
  const imageUrl =
    source.avatar_image_url ?? source.avatarImageUrl ?? source.agentAvatarImageUrl
  const normalized = (kind ?? '').trim().toLowerCase()
  const hasMark =
    Boolean(normalized) ||
    Boolean(icon) ||
    Boolean(imageUrl) ||
    Boolean((colorRaw ?? '').toString().trim()) ||
    Boolean((shapeRaw ?? '').toString().trim())
  if (!hasMark) {
    // Id/name only while the catalog loads — same skeleton as a null source.
    return {
      name: source.name || source.agentName || fallbackName,
      seed: String(source.seed || source.agentId || source.id || '') || undefined,
      kind: 'pending',
    }
  }
  const isOrb = normalized === 'orb' || !normalized
  return {
    name: source.name || source.agentName || fallbackName,
    seed: String(source.seed || source.agentId || source.id || '') || undefined,
    kind: normalized || null,
    icon,
    imageUrl,
    color: isOrb ? resolveBotOrbColor(colorRaw) : colorRaw || DEFAULT_BOT_ORB_COLOR,
    shape: isOrb ? resolveBotOrbShape(shapeRaw) : shapeRaw,
  }
}

/**
 * Prefer the live agents catalog over thread-stamped avatar fields so a mark
 * change does not leave timeline bubbles on initials while the rail already
 * shows the bot.
 */
export function preferLiveAgentAvatar(
  live: AgentAvatarSource | null | undefined,
  stamped: AgentAvatarSource | null | undefined,
): AgentAvatarSource | null {
  if (live) {
    const kind = live.avatar_kind ?? live.avatarKind ?? live.agentAvatarKind
    if (kind) return { ...stamped, ...live }
  }
  return stamped ?? live ?? null
}

export type { BotOrbShapeKey }
export { DEFAULT_BOT_ORB_COLOR, DEFAULT_BOT_ORB_SHAPE }
