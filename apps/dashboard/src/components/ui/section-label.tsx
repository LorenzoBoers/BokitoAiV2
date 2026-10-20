import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

export type SectionLabelProps = {
  title: ReactNode
  /** Optional count after the title (Communication rails). */
  count?: number | string | null
  /** Trailing actions (+, gear). Reveal on section hover when collapsible. */
  actions?: ReactNode
  /**
   * Collapsible when `onOpenChange` is set. Omit both for a static label
   * (detail panels, non-closable groups).
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Body under the label. Always visible when not collapsible. */
  children?: ReactNode
  className?: string
  contentClassName?: string
  /** Extra classes on the header row (padding for panel bands). */
  headerClassName?: string
  /**
   * Fill the parent height (folders hub). Uses flex instead of the grid fold
   * so an inner scroll region can grow.
   */
  fill?: boolean
  /**
   * Props for the collapsible title button (or static title row). Used for
   * rail section drag-reorder — pair with PointerSensor distance so click
   * still toggles open/closed.
   */
  titleButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>
  /**
   * Keep trailing actions out of the row until the header is hovered, so a
   * narrow label can use the full width.
   */
  hoverActions?: boolean
} & Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'>

/**
 * Unified group label for rails and side panels.
 *
 * - With `onOpenChange`: closable header (chevron + `.nav-fold` body).
 * - Without: static muted label; children stay visible.
 */
export function SectionLabel({
  title,
  count,
  actions,
  open = true,
  onOpenChange,
  children,
  className,
  contentClassName,
  headerClassName,
  fill = false,
  titleButtonProps,
  hoverActions = false,
  ...sectionProps
}: SectionLabelProps) {
  const collapsible = typeof onOpenChange === 'function'
  const id = useId()
  const [mounted, setMounted] = useState(open)
  const {
    className: titleButtonClassName,
    onClick: titleButtonOnClick,
    ...restTitleButtonProps
  } = titleButtonProps ?? {}

  useEffect(() => {
    if (!collapsible) {
      setMounted(true)
      return
    }
    if (open) {
      setMounted(true)
      return
    }
    // Fill mode toggles with display; no exit animation to unmount.
    if (fill) {
      setMounted(false)
      return
    }
    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setMounted(false)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), 200)
    return () => window.clearTimeout(timer)
  }, [collapsible, open, fill])

  const showBody = children != null && (!collapsible || mounted)
  const foldOpen = collapsible ? open && mounted : true

  return (
    <section
      {...sectionProps}
      className={cn(
        collapsible ? 'group/section space-y-px' : 'space-y-1',
        fill && 'flex min-h-0 flex-1 flex-col',
        className,
      )}
    >
      <div className={cn('nav-section-line group/header flex items-center gap-0.5', headerClassName)}>
        {collapsible ? (
          <button
            type="button"
            {...restTitleButtonProps}
            onClick={(event) => {
              titleButtonOnClick?.(event)
              if (event.defaultPrevented) return
              if (!open) setMounted(true)
              onOpenChange?.(!open)
            }}
            className={cn('nav-folder min-w-0 flex-1', titleButtonClassName)}
            aria-expanded={open}
            aria-controls={id}
            data-open={open ? 'true' : 'false'}
          >
            <ChevronDown aria-hidden />
            <span className="min-w-0 shrink truncate-fade text-left">{title}</span>
            {count != null && count !== '' ? (
              <span className="shrink-0 tabular-nums text-text-muted/70">{count}</span>
            ) : null}
            <span className="min-w-0 flex-1" aria-hidden />
          </button>
        ) : (
          <div className="nav-folder pointer-events-none min-w-0 flex-1" data-open="true">
            <span className="min-w-0 shrink truncate-fade text-left font-medium">{title}</span>
            {count != null && count !== '' ? (
              <span className="shrink-0 tabular-nums text-text-muted/70">{count}</span>
            ) : null}
            <span className="min-w-0 flex-1" aria-hidden />
          </div>
        )}
        {actions ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center',
              hoverActions && 'hidden group-hover/header:inline-flex',
              collapsible &&
                !hoverActions &&
                'opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100 group-focus-within/section:opacity-100',
            )}
          >
            {actions}
          </span>
        ) : null}
      </div>
      {showBody ? (
        collapsible && fill ? (
          <div
            className={cn('flex min-h-0 flex-1 flex-col', contentClassName)}
            id={id}
            aria-hidden={!open}
          >
            {children}
          </div>
        ) : collapsible ? (
          <div className="nav-fold" data-open={foldOpen ? 'true' : undefined} id={id} aria-hidden={!open}>
            <div className={cn('nav-fold-inner', contentClassName)}>{children}</div>
          </div>
        ) : (
          <div className={contentClassName}>{children}</div>
        )
      ) : null}
    </section>
  )
}

export default SectionLabel
