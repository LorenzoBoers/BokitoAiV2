import {
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Building2,
  Headset,
  HeartHandshake,
  Home,
  Lightbulb,
  Mail,
  MessageCircle,
  Plane,
  Scale,
  Shield,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import {
  DEFAULT_BOT_ORB_COLOR,
  DEFAULT_BOT_ORB_SHAPE,
  resolveBotOrbColor,
  resolveBotOrbShape,
  type BotOrbShapeKey,
} from './bot-orb-shapes'

/** Curated Lucide keys mirrored from the API allow-list (legacy icon mode). */
export const AGENT_AVATAR_ICON_KEYS = [
  'bot',
  'sparkles',
  'headset',
  'mail',
  'message-circle',
  'briefcase',
  'building-2',
  'wrench',
  'heart-handshake',
  'shield',
  'zap',
  'book-open',
  'scale',
  'stethoscope',
  'shopping-bag',
  'plane',
  'home',
  'users',
  'brain',
  'lightbulb',
] as const

export type AgentAvatarIconKey = (typeof AGENT_AVATAR_ICON_KEYS)[number]

export const AGENT_AVATAR_ICONS: Record<AgentAvatarIconKey, LucideIcon> = {
  bot: Bot,
  sparkles: Sparkles,
  headset: Headset,
  mail: Mail,
  'message-circle': MessageCircle,
  briefcase: Briefcase,
  'building-2': Building2,
  wrench: Wrench,
  'heart-handshake': HeartHandshake,
  shield: Shield,
  zap: Zap,
  'book-open': BookOpen,
  scale: Scale,
  stethoscope: Stethoscope,
  'shopping-bag': ShoppingBag,
  plane: Plane,
  home: Home,
  users: Users,
  brain: Brain,
  lightbulb: Lightbulb,
}

export {
  BOT_ORB_COLORS as AGENT_AVATAR_COLORS,
  BOT_ORB_SHAPE_KEYS as AGENT_AVATAR_SHAPE_KEYS,
  DEFAULT_BOT_ORB_COLOR as DEFAULT_AGENT_AVATAR_COLOR,
  DEFAULT_BOT_ORB_SHAPE as DEFAULT_AGENT_AVATAR_SHAPE,
  resolveBotOrbColor as resolveAgentAvatarColor,
  resolveBotOrbShape as resolveAgentAvatarShape,
} from './bot-orb-shapes'

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
  if (!key) return null
  const normalized = key.trim().toLowerCase() as AgentAvatarIconKey
  return AGENT_AVATAR_ICONS[normalized] ?? null
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
    return { name: fallbackName, kind: 'initials' }
  }
  const kind =
    source.avatar_kind ?? source.avatarKind ?? source.agentAvatarKind
  const shapeRaw =
    source.avatar_shape ?? source.avatarShape ?? source.agentAvatarShape
  const colorRaw =
    source.avatar_color ?? source.avatarColor ?? source.agentAvatarColor
  const isOrb = (kind ?? '').trim().toLowerCase() === 'orb'
  return {
    name: source.name || source.agentName || fallbackName,
    seed: String(source.seed || source.agentId || source.id || '') || undefined,
    kind,
    icon: source.avatar_icon ?? source.avatarIcon ?? source.agentAvatarIcon,
    imageUrl:
      source.avatar_image_url ?? source.avatarImageUrl ?? source.agentAvatarImageUrl,
    color: isOrb ? resolveBotOrbColor(colorRaw) : colorRaw,
    shape: isOrb ? resolveBotOrbShape(shapeRaw) : shapeRaw,
  }
}

export type { BotOrbShapeKey }
export { DEFAULT_BOT_ORB_COLOR, DEFAULT_BOT_ORB_SHAPE }
