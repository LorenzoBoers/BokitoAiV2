import type { HTMLAttributes, ReactNode } from 'react'
import { X } from 'lucide-react'
import type { LabelColor } from '../../lib/signals-api'
import { cn } from '../../lib/utils'
import { HashtagMark } from './HashtagMark'

export type TagPillTone = 'free' | 'action' | 'set' | 'inherited'

const FREE_COLOR_PILL: Record<Exclude<LabelColor, ''>, string> = {
  neutral: 'bg-bg-hover text-text-heading',
  accent: 'bg-accent/18 text-accent',
  ai: 'bg-ai/12 text-ai-ink',
  success: 'bg-status-success/12 text-status-success',
  warning: 'bg-status-warning/12 text-status-warning',
  info: 'bg-status-info/12 text-status-info',
}

type PillVisual = {
  tone?: TagPillTone
  color?: LabelColor
  selected?: boolean
  applied?: boolean
  size?: 'sm' | 'md' | 'lg'
  interactive?: boolean
  className?: string
}

/**
 * Stadium pill: soft tinted fill, matching leading dot, no `#`, no hard border.
 * Fits platform tokens (elevated hover fill for free labels, accent wash for action tags).
 */
function pillClassName({
  tone = 'free',
  color = '',
  selected = false,
  applied = false,
  size = 'md',
  interactive = false,
  className,
}: PillVisual) {
  const isAction = tone === 'action'
  const isInherited = tone === 'inherited'
  const freeTint = tone === 'free' && color ? FREE_COLOR_PILL[color] : null
  return cn(
    'tag-pill group/pill inline-flex max-w-full items-center font-medium leading-none transition-colors duration-150',
    size === 'sm' && 'h-5 gap-1 rounded-full px-2 text-[10px]',
    size === 'md' && 'h-7 gap-2 rounded-full px-3.5 text-xs',
    size === 'lg' && 'h-8 gap-2.5 rounded-full px-4 text-sm',
    isInherited
      ? 'bg-bg-elevated/70 text-text-muted'
      : isAction
        ? 'bg-accent/18 text-accent'
        : freeTint ?? 'bg-bg-hover text-text-heading',
    selected && !applied && !isInherited && (isAction ? 'bg-accent/28 text-accent' : 'bg-border-light/40 text-text-heading'),
    !applied &&
      !selected &&
      interactive &&
      (isAction
        ? 'hover:bg-accent/28'
        : isInherited
          ? 'hover:bg-bg-elevated hover:text-text-secondary'
          : 'hover:bg-border-light/35'),
    applied && 'opacity-45',
    className,
  )
}

function PillLabel({
  names,
  tone,
  color = '',
  iconUrl,
  size = 'md',
}: {
  names: string[]
  tone: TagPillTone
  color?: LabelColor
  iconUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const isAction = tone === 'action'
  const gap = size === 'sm' ? 'gap-1' : 'gap-2'
  const mark = size === 'sm' ? 'h-1.5 w-1.5' : size === 'lg' ? 'h-2.5 w-2.5' : 'h-2 w-2'
  if (iconUrl) {
    return (
      <span className={cn('inline-flex min-w-0 items-center', gap)}>
        <img
          src={iconUrl}
          alt=""
          className={cn('shrink-0 rounded-full object-cover', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
        />
        <span className="min-w-0 truncate">{names.join(' · ')}</span>
      </span>
    )
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center', gap)}>
      <HashtagMark category={isAction} color={isAction ? '' : color} className={mark} />
      <span className="min-w-0 truncate">{names.join(' · ')}</span>
    </span>
  )
}

/**
 * Platform label chip: stadium pill, round leading mark, no `#`.
 */
export function TagPill({
  names,
  tone = 'free',
  color = '',
  selected = false,
  applied = false,
  size = 'md',
  iconUrl,
  onClick,
  onRemove,
  removeLabel,
  /** Keep the remove control visible (selection trays); default is hover-reveal. */
  removeAlwaysVisible = false,
  disabled,
  className,
  children,
  title,
}: {
  names: string | string[]
  tone?: TagPillTone
  /** Design-system preset for free labels; ignored for action tags. */
  color?: LabelColor
  selected?: boolean
  applied?: boolean
  size?: 'sm' | 'md' | 'lg'
  iconUrl?: string | null
  onClick?: () => void
  onRemove?: () => void
  removeLabel?: string
  removeAlwaysVisible?: boolean
  disabled?: boolean
  className?: string
  children?: ReactNode
  title?: string
}) {
  const list = (Array.isArray(names) ? names : [names]).map((n) => n.replace(/^#/, '')).filter(Boolean)
  if (!list.length && !children) return null

  const interactive = Boolean(onClick) && !applied && !disabled
  const canRemove = Boolean(onRemove) && !applied
  /** Hover-reveal X overlays the text (no reserved gap). Trays keep an in-flow X. */
  const overlayRemove = canRemove && !removeAlwaysVisible
  const visual = pillClassName({
    tone,
    color,
    selected,
    applied,
    size,
    interactive,
    className: cn(overlayRemove && 'relative', className),
  })
  const removeIcon = size === 'lg' ? 14 : size === 'sm' ? 10 : 12
  const labelGap = size === 'sm' ? 'gap-1' : 'gap-2'
  const label = children ?? <PillLabel names={list} tone={tone} color={color} iconUrl={iconUrl} size={size} />

  return (
    <span
      className={visual}
      data-tag-tone={tone}
      data-selected={selected ? 'true' : undefined}
      data-applied={applied ? 'true' : undefined}
      title={title}
    >
      {onClick ? (
        <button
          type="button"
          disabled={applied || disabled}
          onClick={onClick}
          className={cn(
            'inline-flex min-w-0 items-center bg-transparent text-left disabled:cursor-default',
            labelGap,
            overlayRemove &&
              'transition-[mask-image,-webkit-mask-image] group-hover/pill:[mask-image:linear-gradient(to_right,#000_calc(100%-1.1rem),transparent)] group-hover/pill:[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.1rem),transparent)] group-focus-within/pill:[mask-image:linear-gradient(to_right,#000_calc(100%-1.1rem),transparent)] group-focus-within/pill:[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.1rem),transparent)]',
          )}
        >
          {label}
        </button>
      ) : (
        <span
          className={cn(
            'inline-flex min-w-0 items-center',
            labelGap,
            overlayRemove &&
              'transition-[mask-image,-webkit-mask-image] group-hover/pill:[mask-image:linear-gradient(to_right,#000_calc(100%-1.1rem),transparent)] group-hover/pill:[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.1rem),transparent)] group-focus-within/pill:[mask-image:linear-gradient(to_right,#000_calc(100%-1.1rem),transparent)] group-focus-within/pill:[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.1rem),transparent)]',
          )}
        >
          {label}
        </span>
      )}
      {canRemove ? (
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onRemove?.()
          }}
          aria-label={removeLabel ?? 'Remove'}
          className={cn(
            'inline-flex items-center justify-center rounded-full text-current/80 transition-[opacity,background-color,color] hover:bg-black/5 hover:text-current focus-visible:opacity-100 disabled:opacity-40 dark:hover:bg-white/10',
            size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
            removeAlwaysVisible
              ? 'shrink-0 opacity-100'
              : 'pointer-events-none absolute right-0.5 top-1/2 z-[1] -translate-y-1/2 opacity-0 group-hover/pill:pointer-events-auto group-hover/pill:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
          )}
        >
          <X size={removeIcon} />
        </button>
      ) : null}
    </span>
  )
}

/** Compact inline label — same stadium family as TagPill. */
export function TagPillInline({
  name,
  action = false,
  iconUrl,
  className,
  ...props
}: {
  name: string
  action?: boolean
  iconUrl?: string | null
} & HTMLAttributes<HTMLAnchorElement>) {
  const bare = name.replace(/^#/, '')
  return (
    <a
      className={cn(
        'tag-pill tag-pill--inline inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[0.92em] font-medium leading-none no-underline transition-colors',
        action
          ? 'bg-accent/18 text-accent hover:bg-accent/28'
          : 'bg-bg-hover text-text-heading hover:bg-border-light/35',
        className,
      )}
      data-tag-tone={action ? 'action' : 'free'}
      {...props}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="h-3 w-3 shrink-0 rounded-full object-cover" />
      ) : (
        <HashtagMark category={action} />
      )}
      <span>{bare}</span>
    </a>
  )
}
