import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Label } from '../../ui/label'
import { cn } from '../../../lib/utils'

export function SettingRow({
  icon: Icon,
  htmlFor,
  label,
  hint,
  children,
  first = false,
}: {
  icon: LucideIcon
  htmlFor: string
  label: string
  hint: string
  children: ReactNode
  first?: boolean
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', !first && 'border-t border-border/60 pt-5')}>
      <div className="flex items-start gap-3">
        <Icon size={16} className="mt-0.5 text-accent" />
        <div>
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </Label>
          <p className="mt-0.5 max-w-sm text-xs text-text-muted">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

export function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-text-heading">{title}</h3>
      <p className="mt-0.5 text-xs text-text-muted">{description}</p>
    </div>
  )
}
