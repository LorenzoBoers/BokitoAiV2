import {
  AGENT_AVATAR_ICON_KEYS,
  AGENT_AVATAR_ICONS,
  type AgentAvatarIconKey,
} from './agent-avatar'
import { getAvatarColor } from './avatar'
import type { LucideIcon } from 'lucide-react'

/** Same curated Lucide keys as agents — teams share the picker allow-list. */
export const TEAM_AVATAR_ICON_KEYS = AGENT_AVATAR_ICON_KEYS
export type TeamAvatarIconKey = AgentAvatarIconKey
export const TEAM_AVATAR_ICONS = AGENT_AVATAR_ICONS

export type TeamAvatarKind = 'initials' | 'icon' | 'image'

export type TeamAvatarProps = {
  name?: string | null
  seed?: string
  kind?: TeamAvatarKind | string | null
  icon?: string | null
  color?: string | null
  imageUrl?: string | null
}

export function resolveTeamAvatarIcon(key: string | null | undefined): LucideIcon | null {
  if (!key) return null
  const normalized = key.trim().toLowerCase() as TeamAvatarIconKey
  return TEAM_AVATAR_ICONS[normalized] ?? null
}

/** Normalize API snake_case (or camelCase) into TeamAvatar props. */
export function toTeamAvatarProps(
  source: {
    name?: string | null
    id?: string | number | null
    seed?: string | null
    avatar_kind?: string | null
    avatar_icon?: string | null
    avatar_color?: string | null
    avatar_image_url?: string | null
    avatarKind?: string | null
    avatarIcon?: string | null
    avatarColor?: string | null
    avatarImageUrl?: string | null
  } | null | undefined,
  fallbackName = 'Team',
): TeamAvatarProps {
  if (!source) {
    return { name: fallbackName, kind: 'initials', seed: 'team' }
  }
  const seed = String(source.seed || source.id || '') || undefined
  return {
    name: source.name || fallbackName,
    seed,
    kind: source.avatar_kind ?? source.avatarKind ?? 'initials',
    icon: source.avatar_icon ?? source.avatarIcon,
    color: source.avatar_color ?? source.avatarColor ?? (seed ? getAvatarColor(seed).bg : undefined),
    imageUrl: source.avatar_image_url ?? source.avatarImageUrl,
  }
}
