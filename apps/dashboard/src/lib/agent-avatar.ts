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

/** Curated Lucide keys mirrored from the API allow-list. */
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

/**
 * Platform AI violet (matches `--color-ai` mid tone). Avatars ignore per-agent
 * colors; AiAvatar paints with CSS AI tokens instead. Kept for API payloads /
 * widget theme that still expect a hex string.
 */
export const DEFAULT_AGENT_AVATAR_COLOR = '#7c3aed'

export type AgentAvatarKind = 'initials' | 'icon' | 'image'

/** Fields every surface needs to render the same agent mark. */
export type AgentAvatarProps = {
  name?: string | null
  seed?: string | null
  kind?: AgentAvatarKind | string | null
  icon?: string | null
  imageUrl?: string | null
}

export function resolveAgentAvatarIcon(key: string | null | undefined): LucideIcon | null {
  if (!key) return null
  const normalized = key.trim().toLowerCase() as AgentAvatarIconKey
  return AGENT_AVATAR_ICONS[normalized] ?? null
}

/**
 * Normalize snake_case API fields (or thread camelCase) into AiAvatar props.
 * Color is never forwarded — all agents share platform AI violet.
 */
export function toAiAvatarProps(
  source: {
    name?: string | null
    id?: string | null
    seed?: string | null
    avatar_kind?: string | null
    avatar_icon?: string | null
    avatar_image_url?: string | null
    agentAvatarKind?: string | null
    agentAvatarIcon?: string | null
    agentAvatarImageUrl?: string | null
    agentName?: string | null
    agentId?: string | null
  } | null | undefined,
  fallbackName = 'Agent',
): AgentAvatarProps {
  if (!source) {
    return { name: fallbackName, kind: 'icon', icon: 'sparkles' }
  }
  return {
    name: source.name || source.agentName || fallbackName,
    seed: source.seed || source.id || source.agentId || undefined,
    kind: source.avatar_kind ?? source.agentAvatarKind,
    icon: source.avatar_icon ?? source.agentAvatarIcon,
    imageUrl: source.avatar_image_url ?? source.agentAvatarImageUrl,
  }
}
