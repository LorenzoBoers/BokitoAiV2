import { cn } from '../../lib/utils'

/**
 * The `#` in front of a hashtag. Action tags (hashtags with a flow) use the
 * accent colour; free hashtags stay muted.
 */
export function HashtagMark({ category = false, className }: { category?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('select-none font-semibold leading-none', category ? 'text-accent' : 'text-text-muted', className)}
    >
      #
    </span>
  )
}

/** `#name` with the right mark colour. */
export function Hashtag({
  name,
  category = false,
  className,
}: {
  name: string
  category?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-baseline gap-px', className)}>
      <HashtagMark category={category} />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  )
}

