import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/utils'

export interface RouteTab {
  to: string
  label: string
  end?: boolean
}

interface RouteTabsProps {
  tabs: readonly RouteTab[]
  ariaLabel: string
  className?: string
}

/**
 * Hairline tab strip driven by the router. Same visual as `ui/tabs.tsx`:
 * the active tab is ink-coloured with a 2px underline, no accent tint.
 */
export default function RouteTabs({ tabs, ariaLabel, className }: RouteTabsProps) {
  return (
    <nav className={cn('mb-4 flex items-end gap-1 border-b border-border/60', className)} aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end ?? false}
          className={({ isActive }) =>
            cn(
              '-mb-px inline-flex h-9 items-center border-b-2 px-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-text-heading text-text-heading'
                : 'border-transparent text-text-muted hover:text-text-heading',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
