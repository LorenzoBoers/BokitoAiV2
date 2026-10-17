import { cn } from '../../lib/utils'
import type { LabelColor } from '../../lib/signals-api'
import { useTagMark } from '../../lib/tag-marks'
import {
  FLOW_LABEL_COLOR,
  FLOW_LABEL_ICON,
  labelMarkIcon,
  labelMarkInk,
} from './label-marks'

const MARK_COLOR: Partial<Record<Exclude<LabelColor, ''>, string>> = {
  neutral: 'bg-text-muted',
  accent: 'bg-accent',
  ai: 'bg-ai',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  info: 'bg-status-info',
}

/**
 * Leading mark for a free label (soft muted/tinted dot).
 * Action tags use TagPill with a Lucide mark; `category` is ignored.
 */
export function HashtagMark({
  category: _category = false,
  color = '',
  className,
}: {
  category?: boolean
  color?: LabelColor
  className?: string
}) {
  const tint = color ? MARK_COLOR[color] : null
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        tint ?? 'bg-text-muted',
        className,
      )}
    />
  )
}

function MarkedPill({
  name,
  category,
  size,
  className,
}: {
  name: string
  category: boolean
  size: 'sm' | 'md'
  className?: string
}) {
  const bare = name.replace(/^#/, '')
  const stored = useTagMark(bare)
  const iconId = category ? stored?.icon || FLOW_LABEL_ICON : stored?.icon
  const colorId = category ? stored?.color || FLOW_LABEL_COLOR : stored?.color
  const Icon = labelMarkIcon(iconId)
  const ink = (Icon ? labelMarkInk(colorId) : null) ?? (category ? labelMarkInk(FLOW_LABEL_COLOR) : null)
  const glyph = size === 'sm' ? 11 : 13
  return (
    <span
      className={cn(
        'tag-pill inline-flex max-w-full items-center font-medium leading-none',
        size === 'sm' ? 'h-5 gap-1 rounded-full px-2 text-2xs' : 'h-7 gap-2 rounded-full px-3.5 text-xs',
        !ink && 'bg-bg-hover text-text-heading',
        className,
      )}
      style={ink ? { backgroundColor: ink.wash, color: ink.ink } : undefined}
      data-tag-tone={category ? 'action' : 'free'}
    >
      {Icon ? (
        <Icon size={glyph} className="block shrink-0" aria-hidden />
      ) : (
        <HashtagMark className={size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'} />
      )}
      <span className="min-w-0 truncate">{bare}</span>
    </span>
  )
}

/** Label name as a stadium pill (no `#`). Prefer TagPill when you need remove/click. */
export function Hashtag({
  name,
  category = false,
  className,
}: {
  name: string
  category?: boolean
  className?: string
}) {
  return <MarkedPill name={name} category={category} size="sm" className={className} />
}

/** One stadium pill per label (mark + text). */
export function HashtagSet({
  names,
  category = false,
  className,
  /** Keep one line (rails / trees). Titles may wrap. */
  nowrap = false,
}: {
  names: string[]
  category?: boolean
  className?: string
  nowrap?: boolean
}) {
  const list = names.map((n) => n.replace(/^#/, '')).filter(Boolean)
  if (!list.length) return null
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5',
        nowrap ? 'flex-nowrap overflow-hidden' : 'flex-wrap',
        className,
      )}
    >
      {list.map((name) => (
        <MarkedPill key={name} name={name} category={category} size="md" />
      ))}
    </span>
  )
}
