import type { LucideIcon } from 'lucide-react'
import { platformIcon } from '../../lib/platform-icons'

/** Flow-label hues. Ids match the API allowlist. */
export const LABEL_MARK_COLORS = ['rose', 'teal', 'violet', 'orange', 'emerald', 'pink', 'sky'] as const

export type LabelMarkColor = (typeof LABEL_MARK_COLORS)[number]

export const LABEL_MARK_INK: Record<LabelMarkColor, { ink: string; wash: string }> = {
  rose: { ink: '#fb7185', wash: 'rgba(251, 113, 133, 0.16)' },
  teal: { ink: '#2dd4bf', wash: 'rgba(45, 212, 191, 0.16)' },
  violet: { ink: '#a78bfa', wash: 'rgba(167, 139, 250, 0.16)' },
  orange: { ink: '#fb923c', wash: 'rgba(251, 146, 60, 0.16)' },
  emerald: { ink: '#34d399', wash: 'rgba(52, 211, 153, 0.16)' },
  pink: { ink: '#f472b6', wash: 'rgba(244, 114, 182, 0.16)' },
  sky: { ink: '#38bdf8', wash: 'rgba(56, 189, 248, 0.16)' },
}

/** @deprecated Use platformIcon — kept so `id in LABEL_MARK_ICONS` call sites keep working. */
export const LABEL_MARK_ICONS: Record<string, LucideIcon> = new Proxy(
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

/** New flow labels start blue with the route mark. Ids match the API defaults. */
export const FLOW_LABEL_COLOR: LabelMarkColor = 'sky'
export const FLOW_LABEL_ICON = 'route'

/** Shared stadium geometry for every label chip (TagPill, Hashtag, HashtagSet). */
export const TAG_PILL_SIZE = {
  sm: 'h-5 gap-1 rounded-full px-2 text-2xs',
  md: 'h-7 gap-2 rounded-full px-3.5 text-xs',
  lg: 'h-8 gap-2.5 rounded-full px-4 text-sm',
} as const

export function labelMarkIcon(name: string | null | undefined): LucideIcon | null {
  return platformIcon(name)
}

export function labelMarkInk(color: string | null | undefined): { ink: string; wash: string } | null {
  if (!color || !(color in LABEL_MARK_INK)) return null
  return LABEL_MARK_INK[color as LabelMarkColor]
}
