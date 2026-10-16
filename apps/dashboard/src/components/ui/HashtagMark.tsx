import { Play } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { LabelColor } from '../../lib/signals-api'

const MARK_COLOR: Record<Exclude<LabelColor, ''>, string> = {
  neutral: 'bg-text-muted',
  accent: 'bg-accent',
  ai: 'bg-ai',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  info: 'bg-status-info',
}

/**
 * Leading mark for a label (free) or action tag (flow).
 * Free labels use a soft muted/tinted dot; action tags use an accent play glyph.
 */
export function HashtagMark({
  category = false,
  color = '',
  className,
}: {
  category?: boolean
  color?: LabelColor
  className?: string
}) {
  if (category) {
    // Lucide Play has viewBox padding; slightly larger than the free-label dot
    // so the filled triangle matches the bolletje optically.
    return (
      <Play
        aria-hidden
        className={cn(
          'inline-block h-2 w-2 shrink-0 fill-current text-accent',
          className,
        )}
      />
    )
  }
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
  const bare = name.replace(/^#/, '')
  return (
    <span
      className={cn(
        'tag-pill inline-flex h-5 max-w-full items-center gap-1 rounded-full bg-bg-hover px-2 text-2xs font-medium leading-none',
        category ? 'text-accent' : 'text-text-heading',
        className,
      )}
      data-tag-tone={category ? 'action' : 'free'}
    >
      <HashtagMark category={category} className={category ? 'h-2 w-2' : 'h-1.5 w-1.5'} />
      <span className="min-w-0 truncate">{bare}</span>
    </span>
  )
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
        <span
          key={name}
          className={cn(
            'tag-pill inline-flex h-7 max-w-full items-center gap-2 rounded-full px-3.5 text-xs font-medium leading-none',
            'bg-bg-hover',
            category ? 'text-accent' : 'text-text-heading',
          )}
          data-tag-tone={category ? 'action' : 'free'}
        >
          <HashtagMark category={category} />
          <span className="min-w-0 truncate">{name}</span>
        </span>
      ))}
    </span>
  )
}
