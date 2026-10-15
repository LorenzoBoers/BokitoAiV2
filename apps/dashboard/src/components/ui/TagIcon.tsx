import { cn } from '../../lib/utils'

/**
 * Custom tag glyph only. Prefer `TagPill` / `HashtagMark` (round leading mark) for the
 * default `#` mark — this component is for registry `iconUrl` images.
 */
export function TagIcon({
  iconUrl,
  size = 14,
  className,
  title,
}: {
  /** Custom icon when the tag registry carries one. */
  iconUrl?: string | null
  size?: number
  className?: string
  title?: string
  /** @deprecated Ignored — use HashtagMark for accent `#`. */
  action?: boolean
}) {
  if (!iconUrl) return null

  return (
    <img
      src={iconUrl}
      alt=""
      title={title}
      width={size}
      height={size}
      className={cn('tag-icon shrink-0 rounded-[5px] object-cover', className)}
      style={{ width: size, height: size }}
    />
  )
}
