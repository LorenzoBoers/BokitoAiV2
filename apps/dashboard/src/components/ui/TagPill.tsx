import type { HTMLAttributes, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Hashtag, HashtagMark } from './HashtagMark'

export type TagPillTone = 'free' | 'action' | 'set' | 'inherited'

type PillVisual = {
  tone?: TagPillTone
  selected?: boolean
  applied?: boolean
  size?: 'sm' | 'md' | 'lg'
  interactive?: boolean
  className?: string
}

function pillClassName({
  tone = 'free',
  selected = false,
  applied = false,
  size = 'md',
  interactive = false,
  className,
}: PillVisual) {
  const isAction = tone === 'action'
  const isInherited = tone === 'inherited'
  return cn(
    'tag-pill group/pill inline-flex max-w-full items-center font-medium leading-none tracking-tight transition-[border-color,background-color,box-shadow,transform,opacity] duration-150',
    size === 'sm' && 'h-6 gap-1 rounded-md px-1.5 text-2xs',
    size === 'md' && 'h-7 gap-1.5 rounded-lg px-2 text-xs',
    size === 'lg' && 'h-9 gap-2 rounded-xl px-3 text-sm',
    isAction
      ? 'border border-accent/30 bg-gradient-to-b from-accent/16 to-accent/[0.07] text-text-heading'
      : isInherited
        ? 'border border-dashed border-border/60 bg-transparent text-text-muted'
        : 'border border-white/[0.07] bg-gradient-to-b from-white/[0.07] to-white/[0.02] text-text-heading shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
    selected &&
      !applied &&
      'border-accent/50 from-accent/20 to-accent/10 shadow-[0_0_0_1px_rgba(52,211,153,0.18)]',
    !applied &&
      !selected &&
      interactive &&
      (isAction
        ? 'hover:border-accent/50 hover:from-accent/22 hover:to-accent/10'
        : 'hover:border-white/12 hover:from-white/[0.1] hover:to-white/[0.04]'),
    applied && 'opacity-40',
    className,
  )
}

function PillLabel({
  names,
  tone,
  iconUrl,
}: {
  names: string[]
  tone: TagPillTone
  iconUrl?: string | null
}) {
  const isAction = tone === 'action'
  if (iconUrl) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <img src={iconUrl} alt="" className="h-3.5 w-3.5 shrink-0 rounded object-cover" />
        <span className="min-w-0 truncate">{names.join(' · ')}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {names.map((name, index) => (
        <span key={`${name}-${index}`} className="inline-flex min-w-0 items-center gap-1">
          {index > 0 ? (
            <span aria-hidden className="shrink-0 text-text-muted/55">
              ·
            </span>
          ) : null}
          <Hashtag name={name} category={isAction} />
        </span>
      ))}
    </span>
  )
}

/**
 * Platform tag chip. Soft glass + typographic inline `#name` (coloured `#`,
 * spaced from the label). Multi-tag sets: `#a · #b`.
 */
export function TagPill({
  names,
  tone = 'free',
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
  const visual = pillClassName({ tone, selected, applied, size, interactive, className })
  const removeIcon = size === 'lg' ? 14 : size === 'sm' ? 10 : 12

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
          className="inline-flex min-w-0 items-center gap-1 bg-transparent text-left disabled:cursor-default"
        >
          {children ?? <PillLabel names={list} tone={tone} iconUrl={iconUrl} />}
        </button>
      ) : (
        (children ?? <PillLabel names={list} tone={tone} iconUrl={iconUrl} />)
      )}
      {onRemove && !applied ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          aria-label={removeLabel ?? 'Remove'}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-md text-text-muted/80 transition-[opacity,background-color,color] hover:bg-white/10 hover:text-text-primary focus-visible:opacity-100 disabled:opacity-40',
            size === 'lg' ? 'h-7 w-7 -mr-1' : size === 'sm' ? 'h-5 w-5 -mr-0.5' : 'h-6 w-6 -mr-0.5',
            removeAlwaysVisible
              ? 'opacity-100'
              : 'opacity-0 group-hover/pill:opacity-100 focus-visible:opacity-100',
          )}
        >
          <X size={removeIcon} />
        </button>
      ) : null}
    </span>
  )
}

/** Compact `#name` for chat inline — same visual family as TagPill. */
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
        'tag-pill tag-pill--inline inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[0.92em] font-medium leading-none no-underline transition-colors',
        action
          ? 'border-accent/30 bg-accent/10 text-text-heading hover:border-accent/50 hover:bg-accent/15'
          : 'border-white/[0.08] bg-white/[0.05] text-text-heading hover:border-white/14 hover:bg-white/[0.08]',
        className,
      )}
      data-tag-tone={action ? 'action' : 'free'}
      {...props}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="h-3 w-3 shrink-0 rounded object-cover" />
      ) : (
        <HashtagMark category={action} />
      )}
      <span>{bare}</span>
    </a>
  )
}
