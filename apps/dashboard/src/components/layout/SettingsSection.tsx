import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { cn } from '../../lib/utils'

interface SettingsSectionProps {
  title: ReactNode
  description?: ReactNode
  /** Optional leading visual (brand logo tile, icon) left of the title. */
  icon?: ReactNode
  /** Optional actions rendered on the right of the header (Save button, etc). */
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Override the card body padding. Defaults to `p-5` (the Card default). */
  bodyClassName?: string
}

/**
 * Standard settings form grouping. Wraps content in `Card` with a
 * compact header (title + optional description + actions) and a content
 * region. Replaces ad hoc `<Card p-6>` and `<div rounded-2xl border>` patterns
 * across the settings pages.
 */
export function SettingsSection({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: SettingsSectionProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex-wrap items-start gap-3">
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <div className="min-w-0 flex-1">
          <CardTitle>{title}</CardTitle>
          {description ? (
            <p className="mt-1 text-xs text-text-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className={cn(bodyClassName)}>{children}</CardContent>
    </Card>
  )
}

export default SettingsSection
