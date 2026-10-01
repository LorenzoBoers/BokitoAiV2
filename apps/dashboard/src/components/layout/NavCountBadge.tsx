type NavCountBadgeProps = {
  count: number
  max?: number
  variant?: 'default' | 'muted'
  /** Rail icons: absolute top-right. Sidebar links: inline pill after label. */
  placement?: 'rail' | 'inline'
  className?: string
}

function formatCount(count: number, max: number): string {
  if (count > max) return `${max}+`
  return String(count)
}

export default function NavCountBadge({
  count,
  max = 99,
  variant = 'default',
  placement = 'rail',
  className = '',
}: NavCountBadgeProps) {
  if (count <= 0) return null

  const label = formatCount(count, max)
  const colorClass =
    variant === 'muted'
      ? 'bg-text-muted text-bg'
      : 'bg-accent text-accent-fg border border-bg'

  // Inline (nav rows): quiet tabular text, accent only when it signals unread.
  if (placement === 'inline') {
    return (
      <span
        className={`nav-count shrink-0 ${className}`}
        data-unread={variant === 'default' ? 'true' : 'false'}
        aria-hidden
      >
        {label}
      </span>
    )
  }

  return (
    <span
      className={`count-pop pointer-events-none absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-2xs font-bold leading-none ${colorClass} ${className}`}
      aria-hidden
    >
      {label}
    </span>
  )
}
