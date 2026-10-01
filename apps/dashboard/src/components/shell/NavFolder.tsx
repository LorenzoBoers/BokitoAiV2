import { useId, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

type NavFolderProps = {
  label: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
  /** Right-aligned slot in the header (action icon, count). */
  trailing?: ReactNode
  /** Render children without the header (collapsed rail, single-item groups). */
  flat?: boolean
  className?: string
  'data-tour'?: string
}

/**
 * Folder-style nav group: a quiet sentence-case header with a left chevron,
 * followed by rows. The fold animates via the `.nav-fold` grid recipe.
 */
export default function NavFolder({
  label,
  open,
  onToggle,
  children,
  trailing,
  flat = false,
  className,
  ...rest
}: NavFolderProps) {
  const id = useId()
  if (flat) {
    return (
      <section className={cn('space-y-px', className)} {...rest}>
        {children}
      </section>
    )
  }
  return (
    <section className={className} {...rest}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="nav-folder min-w-0 flex-1"
          aria-expanded={open}
          aria-controls={id}
          data-open={open ? 'true' : 'false'}
        >
          <ChevronDown aria-hidden />
          <span className="min-w-0 truncate-fade">{label}</span>
        </button>
        {trailing ? <span className="ml-1 flex shrink-0 items-center">{trailing}</span> : null}
      </div>
      <div className="nav-fold" data-open={open ? 'true' : 'false'} id={id}>
        <div className={cn('nav-fold-inner', open && 'pt-px')}>
          <div className="space-y-px">{children}</div>
        </div>
      </div>
    </section>
  )
}
