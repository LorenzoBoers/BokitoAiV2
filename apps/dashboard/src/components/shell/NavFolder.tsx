import type { ReactNode } from 'react'
import { SectionLabel } from '../ui/section-label'
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
 * Shell rail group — thin wrapper over the shared {@link SectionLabel}.
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
  if (flat) {
    return (
      <section className={cn('space-y-px', className)} {...rest}>
        {children}
      </section>
    )
  }
  return (
    <SectionLabel
      title={label}
      open={open}
      onOpenChange={() => onToggle()}
      actions={trailing}
      className={className}
      contentClassName={open ? 'space-y-px pt-px' : 'space-y-px'}
      {...rest}
    >
      {children}
    </SectionLabel>
  )
}
