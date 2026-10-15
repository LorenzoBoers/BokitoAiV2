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
 * Round leading mark for a label (free) or action tag.
 * Action tags use accent; free labels use a softer muted dot that sits on tinted pills.
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
  const tint = !category && color ? MARK_COLOR[color] : null
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        tint ?? (category ? 'bg-accent' : 'bg-text-muted'),
        className,
      )}
    />
  )
}

/** Label name with a leading round mark (no `#`). Prefer TagPill for chips. */
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
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-2', className)}>
      <HashtagMark category={category} />
      <span className="min-w-0 truncate">{bare}</span>
    </span>
  )
}

/** One stadium pill per label (dot + text). */
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
            category ? 'bg-accent/18 text-accent' : 'bg-bg-hover text-text-heading',
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
