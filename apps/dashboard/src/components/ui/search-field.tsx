import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { cn } from '../../lib/utils'

type SearchFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> & {
  value: string
  onChange: (value: string) => void
  size?: 'sm' | 'md'
  /** Wrapper class (width). */
  className?: string
  /**
   * Keyboard hint on the right when the field is empty (e.g. "Ctrl K").
   * Used by the command-palette trigger; filter fields leave this unset.
   */
  shortcut?: string
}

/** Text input with a search icon, optional shortcut hint, and a clear button. */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ value, onChange, size = 'md', className, placeholder, shortcut, readOnly, onKeyDown, ...props }, ref) => {
    const { t } = useTranslation('common')
    const showShortcut = Boolean(shortcut) && !value
    return (
      <div className={cn('relative w-full', className)}>
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <input
          ref={ref}
          type="search"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event)
            if (event.defaultPrevented) return
            if (event.key === 'Escape' && value) {
              event.preventDefault()
              onChange('')
            }
          }}
          placeholder={placeholder ?? t('search.placeholder')}
          className={cn(
            'w-full rounded-md border border-border/70 bg-bg-input pl-8 text-sm text-text-primary placeholder:text-text-muted outline-none transition-[border-color,box-shadow] duration-150 hover:border-border-light focus:border-border-focus focus:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.15)] [&::-webkit-search-cancel-button]:hidden',
            size === 'sm' ? 'h-8' : 'h-9',
            showShortcut ? 'pr-16' : 'pr-8',
            readOnly && 'cursor-pointer',
          )}
          {...props}
        />
        {showShortcut ? (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-sm border border-border/70 px-1 font-mono text-2xs text-text-muted">
            {shortcut}
          </kbd>
        ) : null}
        {value && !readOnly ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('actions.clear')}
            className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-heading"
          >
            <X size={12} aria-hidden />
          </button>
        ) : null}
      </div>
    )
  },
)
SearchField.displayName = 'SearchField'

export default SearchField
