import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

type SegmentedControlProps<T extends string> = {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  size?: 'sm' | 'md'
  /** Fill the container width; segments share it equally. */
  stretch?: boolean
  className?: string
  'aria-label'?: string
}

/** Pick one of 2-5 short options in place (modes, ranges, views). */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  stretch = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const pad = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm'
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'max-w-full gap-0.5 rounded-lg border border-border/60 bg-bg-input/40 p-0.5 dark:bg-bg-input/55',
        stretch ? 'flex w-full' : 'inline-flex flex-wrap',
        className,
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus disabled:pointer-events-none disabled:opacity-50',
              stretch && 'min-w-0 flex-1',
              pad,
              active
                ? 'bg-bg-surface text-text-heading ring-1 ring-border/40'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
