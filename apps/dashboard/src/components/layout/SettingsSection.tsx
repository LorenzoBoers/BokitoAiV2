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
 * Standard settings form grouping. Header stays one compact row (title +
 * actions). A longer description sits in a band under the header so it
 * cannot overflow the h-11 bar onto the body.
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
      <CardHeader>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {icon ? <div className="shrink-0">{icon}</div> : null}
          <CardTitle>{title}</CardTitle>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </CardHeader>
      {description ? (
        <p className="border-b border-border/60 px-4 py-2 text-xs leading-5 text-text-secondary">
          {description}
        </p>
      ) : null}
      <CardContent className={cn(bodyClassName)}>{children}</CardContent>
    </Card>
  )
}

export default SettingsSection
