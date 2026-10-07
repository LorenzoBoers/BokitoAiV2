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
}

/** Text input with a search icon and a clear button. */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ value, onChange, size = 'md', className, placeholder, ...props }, ref) => {
    const { t } = useTranslation('common')
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
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t('search.placeholder')}
          className={cn(
            'w-full rounded-md border border-border bg-bg-input pl-8 pr-8 text-sm text-text-primary placeholder:text-text-muted outline-none transition-[border-color,box-shadow] duration-150 hover:border-border-light focus:border-border-focus focus:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.15)] [&::-webkit-search-cancel-button]:hidden',
            size === 'sm' ? 'h-8' : 'h-9',
          )}
          {...props}
        />
        {value ? (
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
