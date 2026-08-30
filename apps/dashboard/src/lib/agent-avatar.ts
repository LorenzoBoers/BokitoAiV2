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

/** Hex swatches mirrored from the API allow-list. */
export const AGENT_AVATAR_COLORS = [
  '#4652f2',
  '#7c3aed',
  '#0891b2',
  '#0d9488',
  '#059669',
  '#d97706',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#2563eb',
  '#16a34a',
  '#ea580c',
] as const

export type AgentAvatarKind = 'initials' | 'icon' | 'image'

export function resolveAgentAvatarIcon(key: string | null | undefined): LucideIcon | null {
  if (!key) return null
  const normalized = key.trim().toLowerCase() as AgentAvatarIconKey
  return AGENT_AVATAR_ICONS[normalized] ?? null
}
