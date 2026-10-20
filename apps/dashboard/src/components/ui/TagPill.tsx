import type { HTMLAttributes, ReactNode } from 'react'
import { X } from 'lucide-react'
import type { LabelColor } from '../../lib/signals-api'
import { useTagMark } from '../../lib/tag-marks'
import { cn } from '../../lib/utils'
import { HashtagMark } from './HashtagMark'
import { TAG_PILL_SIZE, labelMarkIcon, labelMarkInk } from './label-marks'

export type TagPillTone = 'free' | 'action' | 'set' | 'inherited'

const FREE_COLOR_PILL: Partial<Record<Exclude<LabelColor, ''>, string>> = {
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
  marked?: boolean
  className?: string
}

/**
 * Stadium pill: soft tinted fill, matching leading mark, no `#`, no hard border.
 * A mark (color + icon) paints only when the label has a flow. Otherwise a dot.
 */
function pillClassName({
  tone = 'free',
  color = '',
  selected = false,
  applied = false,
  size = 'md',
  interactive = false,
  marked = false,
  className,
}: PillVisual) {
  const painted = tone === 'action' && marked
  const isInherited = tone === 'inherited'
  const freeTint = !painted && color ? FREE_COLOR_PILL[color] : null
  return cn(
    'tag-pill group/pill inline-flex max-w-full items-center font-medium leading-none transition-colors duration-150 [&_svg]:block',
    TAG_PILL_SIZE[size],
    isInherited
      ? 'bg-bg-elevated/70 text-text-muted'
      : painted
        ? null
        : freeTint ?? 'bg-bg-hover text-text-heading',
    selected && !applied && !isInherited && !painted && !marked && 'bg-border-light/40 text-text-heading',
    !applied &&
      !selected &&
      interactive &&
      !marked &&
      !painted &&
      (isInherited
        ? 'hover:bg-bg-elevated hover:text-text-secondary'
        : 'hover:bg-border-light/35'),
    applied && 'opacity-45',
    className,
  )
}

function PillLabel({
  names,
  color = '',
  iconUrl,
  icon,
  size = 'md',
}: {
  names: string[]
  color?: LabelColor
  iconUrl?: string | null
  icon?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const Mark = labelMarkIcon(icon)
  const gap = size === 'sm' ? 'gap-1' : 'gap-2'
  const mark =
    size === 'sm' ? 'h-1.5 w-1.5' : size === 'lg' ? 'h-2.5 w-2.5' : 'h-2 w-2'
  if (Mark) {
    const glyph = size === 'sm' ? 11 : size === 'lg' ? 15 : 13
    return (
      <span className={cn('inline-flex min-w-0 items-center', gap)}>
        <Mark size={glyph} className="block shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{names.join(' · ')}</span>
      </span>
    )
  }
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
      <HashtagMark color={color} className={mark} />
      <span className="min-w-0 truncate">{names.join(' · ')}</span>
    </span>
  )
}

/**
 * Platform label chip: stadium pill, leading mark, no `#`.
 * Color and icon paint only when this label has a flow.
 */
export function TagPill({
  names,
  tone = 'free',
  color = '',
  selected = false,
  applied = false,
  size = 'md',
  iconUrl,
  icon,
  onClick,
  onRemove,
  removeLabel,
  /** Keep the remove control visible (selection trays); default is hover-reveal. */
  removeAlwaysVisible = false,
  disabled,
  className,
  children,
  /** Extra content after the label, inside the same pill (stage on a list row). */
  trailing,
  title,
}: {
  names: string | string[]
  tone?: TagPillTone
  /** Hue. Painted only together with an icon, and only for a label that has a flow. */
  color?: LabelColor
  selected?: boolean
  applied?: boolean
  size?: 'sm' | 'md' | 'lg'
  iconUrl?: string | null
  /** Lucide kebab id from the label catalog. */
  icon?: string
  onClick?: () => void
  onRemove?: () => void
  removeLabel?: string
  removeAlwaysVisible?: boolean
  disabled?: boolean
  className?: string
  children?: ReactNode
  trailing?: ReactNode
  title?: string
}) {
  const list = (Array.isArray(names) ? names : [names]).map((n) => n.replace(/^#/, '')).filter(Boolean)
  const stored = useTagMark(list[0] ?? '')
  // A mark is color plus icon from the call site or the catalog. The catalog
  // only keeps a mark for a label that currently has a flow. No fallback wash.
  const useCatalog = list.length === 1 && tone === 'action'
  const resolvedColor = (color || (useCatalog ? stored?.color : '') || '') as LabelColor
  const resolvedIcon = icon || (useCatalog ? stored?.icon : '') || ''
  if (!list.length && !children) return null

  const interactive = Boolean(onClick) && !applied && !disabled
  const canRemove = Boolean(onRemove) && !applied
  /** Hover-reveal X overlays the text (no reserved gap). Trays keep an in-flow X. */
  const overlayRemove = canRemove && !removeAlwaysVisible
  const ink = labelMarkIcon(resolvedIcon) ? labelMarkInk(resolvedColor) : null
  const visual = pillClassName({
    tone,
    color: resolvedColor,
    selected,
    applied,
    size,
    interactive,
    marked: Boolean(ink),
    className: cn(overlayRemove && 'relative', className),
  })
  const removeIcon = size === 'lg' ? 14 : size === 'sm' ? 10 : 12
  const labelGap = size === 'sm' ? 'gap-1' : 'gap-2'
  const label = children ?? (
    <PillLabel
      names={list}
      color={resolvedColor}
      iconUrl={iconUrl}
      icon={resolvedIcon}
      size={size}
    />
  )

  return (
    <span
      className={visual}
      style={ink ? { backgroundColor: ink.wash, color: ink.ink } : undefined}
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
          {trailing}
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
          {trailing}
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
  const stored = useTagMark(bare)
  const iconId = action ? stored?.icon || '' : ''
  const colorId = action ? stored?.color || '' : ''
  const Mark = labelMarkIcon(iconId)
  const ink = Mark ? labelMarkInk(colorId) : null
  return (
    <a
      className={cn(
        'tag-pill tag-pill--inline inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[0.92em] font-medium leading-none no-underline transition-colors',
        !ink && 'bg-bg-hover text-text-heading hover:bg-border-light/35',
        className,
      )}
      style={ink ? { backgroundColor: ink.wash, color: ink.ink } : undefined}
      data-tag-tone={action || Mark ? 'action' : 'free'}
      {...props}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="h-3 w-3 shrink-0 rounded-full object-cover" />
      ) : Mark ? (
        <Mark size={11} className="block shrink-0" aria-hidden />
      ) : (
        <HashtagMark />
      )}
      <span>{bare}</span>
    </a>
  )
}
