import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { TagPill, type TagPillTone } from './TagPill'

export type TagChip = {
  name: string
  tone?: TagPillTone
  /** Soft / non-removable (inherited). */
  locked?: boolean
  title?: string
}

/**
 * Multi-select chip field: selected labels as removable stadium pills,
 * caret typing after them for search or a new name.
 */
export function TagChipInput({
  chips,
  value,
  onChange,
  onSubmit,
  onRemove,
  placeholder,
  disabled,
  autoFocus,
  className,
  leading,
  'aria-label': ariaLabel,
}: {
  chips: TagChip[]
  value: string
  onChange: (next: string) => void
  onSubmit?: () => void
  onRemove?: (name: string) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  leading?: ReactNode
  'aria-label'?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit?.()
      return
    }
    if (event.key === 'Backspace' && !value && chips.length > 0) {
      const last = [...chips].reverse().find((chip) => !chip.locked)
      if (last && onRemove) {
        event.preventDefault()
        onRemove(last.name)
      }
    }
  }

  return (
    <div
      role="group"
      className={cn(
        'flex min-h-11 cursor-text flex-wrap items-center gap-1.5 rounded-xl border border-border bg-bg-input px-2.5 py-1.5 transition-[border-color,box-shadow] duration-150',
        'focus-within:border-accent/50 focus-within:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.12)]',
        disabled && 'opacity-60',
        className,
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget || (event.target as HTMLElement).dataset?.chipShell) {
          event.preventDefault()
          inputRef.current?.focus()
        }
      }}
      data-chip-shell=""
    >
      {leading}
      {chips.map((chip) => (
        <TagPill
          key={chip.name}
          names={chip.name}
          tone={chip.tone ?? 'free'}
          size="sm"
          selected={!chip.locked}
          applied={chip.locked}
          title={chip.title}
          removeAlwaysVisible={!chip.locked && Boolean(onRemove)}
          onRemove={
            chip.locked || !onRemove
              ? undefined
              : () => {
                  onRemove(chip.name)
                  inputRef.current?.focus()
                }
          }
          removeLabel={chip.name}
          disabled={disabled}
        />
      ))}
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={chips.length ? undefined : placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="min-h-7 min-w-[7rem] flex-1 bg-transparent py-0.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
      />
    </div>
  )
}
