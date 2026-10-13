import { cn } from '../../lib/utils'

/**
 * The `#` in front of a tag. Pass `category` for accent colour on action tags
 * (Tags list and Communication rail); omit it for a muted gray `#` on free tags.
 */
export function HashtagMark({ category = false, className }: { category?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'select-none font-semibold leading-none',
        category ? 'text-accent' : 'text-text-muted/80',
        className,
      )}
    >
      #
    </span>
  )
}

/** `#name` with the right mark colour and breathing room after `#`. */
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
    <span className={cn('inline-flex min-w-0 max-w-full items-baseline gap-1.5', className)}>
      <HashtagMark category={category} className="shrink-0" />
      <span className="min-w-0 truncate">{bare}</span>
    </span>
  )
}

/** `#a · #b` for filtersets and multi-tag titles. */
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
        'inline-flex min-w-0 max-w-full items-baseline gap-x-1.5 gap-y-0.5',
        nowrap ? 'flex-nowrap overflow-hidden' : 'flex-wrap',
        className,
      )}
    >
      {list.map((name, index) => (
        <span key={`${name}-${index}`} className="inline-flex min-w-0 shrink items-baseline gap-1.5">
          {index > 0 ? (
            <span aria-hidden className="shrink-0 text-text-muted/55">
              ·
            </span>
          ) : null}
          <Hashtag name={name} category={category} />
        </span>
      ))}
    </span>
  )
}
