import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '../../lib/utils'

const TEXT = {
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
} as const

const SHELL = {
  lg: 'h-10 rounded-full px-4',
  xl: 'h-10 rounded-full px-4',
  '2xl': 'h-12 rounded-full px-5',
} as const

/**
 * Page-title name. At rest it is plain type. Hover and focus fill a pill in
 * the same family as a tag pill. The pencil sits over the end of the name,
 * and the text fades out under it so the pill does not grow.
 */
export function NameEdit({
  value,
  canEdit = false,
  editing = false,
  onStart,
  onChange,
  onCommit,
  onCancel,
  commitOnBlur = true,
  invalid = false,
  disabled = false,
  label,
  heading: Heading = 'h1',
  size = 'xl',
  className,
}: {
  value: string
  canEdit?: boolean
  editing?: boolean
  onStart?: () => void
  onChange?: (next: string) => void
  onCommit?: () => void
  onCancel?: () => void
  /** Folder names save when the field closes. Flow names stay in the edit bar. */
  commitOnBlur?: boolean
  invalid?: boolean
  disabled?: boolean
  label: string
  heading?: 'h1' | 'h2' | 'span'
  size?: keyof typeof SHELL
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlur = useRef(false)
  const wasEditing = useRef(false)

  // Focus and select only when edit mode starts — not on every keystroke.
  // Re-selecting on `value` replaced the whole name with the next character.
  useEffect(() => {
    const el = inputRef.current
    if (!editing) {
      wasEditing.current = false
      return
    }
    if (!el) return
    if (!wasEditing.current) {
      wasEditing.current = true
      el.focus()
      el.select()
    }
    // Hug the text: HTML size=chars overestimates with proportional fonts.
    el.style.width = '0px'
    el.style.width = `${Math.max(el.scrollWidth, 48)}px`
  }, [editing, value])

  const type = cn('min-w-0 font-semibold tracking-[-0.01em] text-text-heading', TEXT[size])

  if (editing) {
    return (
      <Heading className="w-fit max-w-full min-w-0">
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false
              return
            }
            if (commitOnBlur) onCommit?.()
          }}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (commitOnBlur) event.currentTarget.blur()
              else onCommit?.()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              skipBlur.current = true
              onCancel?.()
            }
          }}
          className={cn(
            type,
            SHELL[size],
            'max-w-[28rem] border bg-bg-hover/70 outline-none focus:ring-1',
            invalid
              ? 'border-status-error/60 focus:ring-status-error/30'
              : 'border-border/70 focus:border-border focus:ring-border/60',
            className,
          )}
        />
      </Heading>
    )
  }

  if (!canEdit || !onStart) {
    return <Heading className={cn(type, 'truncate', className)}>{value}</Heading>
  }

  return (
    <Heading className="w-fit max-w-full min-w-0">
      <button
        type="button"
        onClick={onStart}
        aria-label={label}
        className={cn(
          'group/name relative inline-flex max-w-full min-w-0 items-center text-left transition-colors',
          SHELL[size],
          type,
          'hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          className,
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate leading-none transition-[mask-image,-webkit-mask-image]',
            'group-hover/name:[mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)]',
            'group-hover/name:[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)]',
            'group-focus-visible/name:[mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)]',
            'group-focus-visible/name:[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)]',
          )}
        >
          {value}
        </span>
        <Pencil
          size={size === '2xl' ? 16 : 14}
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-muted opacity-0 transition-opacity duration-150 group-hover/name:opacity-100 group-focus-visible/name:opacity-100',
            size === '2xl' ? 'right-4' : 'right-3',
          )}
          aria-hidden
        />
      </button>
    </Heading>
  )
}

/**
 * Short blurb under a title — same click-to-edit feel as NameEdit, for a
 * few lines of prose (agent description, etc.).
 */
export function BlurbEdit({
  value,
  canEdit = false,
  editing = false,
  onStart,
  onChange,
  onCommit,
  onCancel,
  commitOnBlur = true,
  disabled = false,
  label,
  emptyLabel,
  placeholder,
  maxLength,
  className,
}: {
  value: string
  canEdit?: boolean
  editing?: boolean
  onStart?: () => void
  onChange?: (next: string) => void
  onCommit?: () => void
  onCancel?: () => void
  commitOnBlur?: boolean
  disabled?: boolean
  label: string
  emptyLabel: string
  placeholder?: string
  maxLength?: number
  className?: string
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const skipBlur = useRef(false)
  const wasEditing = useRef(false)

  useEffect(() => {
    const el = areaRef.current
    if (!editing) {
      wasEditing.current = false
      return
    }
    if (!el) return
    if (!wasEditing.current) {
      wasEditing.current = true
      el.focus()
      el.select()
    }
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [editing, value])

  if (editing) {
    return (
      <div className={cn('w-full max-w-md', className)}>
        <textarea
          ref={areaRef}
          value={value}
          disabled={disabled}
          aria-label={label}
          rows={2}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => {
            const next = maxLength ? event.target.value.slice(0, maxLength) : event.target.value
            onChange?.(next)
          }}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false
              return
            }
            if (commitOnBlur) onCommit?.()
          }}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              skipBlur.current = true
              onCancel?.()
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              if (commitOnBlur) event.currentTarget.blur()
              else onCommit?.()
            }
          }}
          className="w-full resize-none rounded-xl border border-border/70 bg-bg-hover/70 px-3 py-2 text-sm leading-relaxed text-text-secondary outline-none focus:border-border focus:ring-1 focus:ring-border/60"
        />
        {maxLength != null ? (
          <p className="mt-1 text-center text-2xs text-text-muted">
            {value.trim().length}/{maxLength}
          </p>
        ) : null}
      </div>
    )
  }

  const trimmed = value.trim()
  if (!canEdit || !onStart) {
    if (!trimmed) return null
    return (
      <p className={cn('max-w-md text-center text-sm leading-relaxed text-text-secondary', className)}>
        {trimmed}
      </p>
    )
  }

  if (!trimmed) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onStart}
        className={cn(
          'text-sm text-text-muted transition-colors hover:text-text-secondary disabled:opacity-50',
          className,
        )}
      >
        {emptyLabel}
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onStart}
      aria-label={label}
      className={cn(
        'group/blurb relative max-w-md rounded-xl px-3 py-1.5 text-center text-sm leading-relaxed text-text-secondary transition-colors',
        'hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        className,
      )}
    >
      <span
        className={cn(
          'block transition-[mask-image,-webkit-mask-image]',
          'group-hover/blurb:[mask-image:linear-gradient(to_bottom,#000_calc(100%-1rem),transparent)]',
          'group-hover/blurb:[-webkit-mask-image:linear-gradient(to_bottom,#000_calc(100%-1rem),transparent)]',
          'group-focus-visible/blurb:[mask-image:linear-gradient(to_bottom,#000_calc(100%-1rem),transparent)]',
          'group-focus-visible/blurb:[-webkit-mask-image:linear-gradient(to_bottom,#000_calc(100%-1rem),transparent)]',
        )}
      >
        {trimmed}
      </span>
      <Pencil
        size={13}
        className="pointer-events-none absolute bottom-1.5 right-2 text-text-muted opacity-0 transition-opacity duration-150 group-hover/blurb:opacity-100 group-focus-visible/blurb:opacity-100"
        aria-hidden
      />
    </button>
  )
}
