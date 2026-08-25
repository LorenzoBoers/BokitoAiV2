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

  if (placement === 'inline') {
    return (
      <span
        className={`ml-auto inline-flex min-h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none ${colorClass} ${className}`}
        aria-hidden
      >
        {label}
      </span>
    )
  }

  return (
    <span
      className={`pointer-events-none absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none shadow-sm ${colorClass} ${className}`}
      aria-hidden
    >
      {label}
    </span>
  )
}
