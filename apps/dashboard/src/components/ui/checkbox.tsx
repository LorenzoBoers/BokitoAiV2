import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils'

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: React.ReactNode
  description?: React.ReactNode
}

/**
 * Native checkbox on the token palette: 16px box, `border-light` edge, accent
 * fill with a check when on. `className` sits on the outer element so callers
 * can position it; the remaining props go to the `<input>`.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, ...props }, ref) => {
    const box = (
      <span className={cn('relative inline-flex h-4 w-4 shrink-0', label == null && className)}>
        <input
          ref={ref}
          type="checkbox"
          className="peer m-0 h-4 w-4 cursor-pointer appearance-none rounded-sm border border-border-light bg-bg-input transition-colors checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
        <Check
          aria-hidden
          className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-accent-fg opacity-0 peer-checked:opacity-100"
        />
      </span>
    )
    if (label == null) return box
    return (
      <label className={cn('flex cursor-pointer items-start gap-2 text-sm', className)}>
        <span className="mt-0.5 inline-flex">{box}</span>
        <span className="min-w-0">
          <span className="block text-text-primary">{label}</span>
          {description ? <span className="mt-0.5 block text-xs text-text-muted">{description}</span> : null}
        </span>
      </label>
    )
  },
)
Checkbox.displayName = 'Checkbox'

export default Checkbox
