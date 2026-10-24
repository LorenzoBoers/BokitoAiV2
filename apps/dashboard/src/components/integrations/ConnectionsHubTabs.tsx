import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  CONNECTIONS_DISCOVER_PATH,
  CONNECTIONS_INSTALLED_PATH,
  type ConnectionsHubTab,
} from '../../lib/integration-kind-url'
import { cn } from '../../lib/utils'

type Props = {
  active: ConnectionsHubTab
  installedCount?: number
  className?: string
}

/** Discover vs Installed on the Connections hub. */
export function ConnectionsHubTabs({ active, installedCount, className }: Props) {
  const { t } = useTranslation('nav')

  const tabs: Array<{ id: ConnectionsHubTab; to: string; label: string; count?: number }> = [
    {
      id: 'discover',
      to: CONNECTIONS_DISCOVER_PATH,
      label: t('integrations.hubTabs.discover', { defaultValue: 'Discover' }),
    },
    {
      id: 'installed',
      to: CONNECTIONS_INSTALLED_PATH,
      label: t('integrations.hubTabs.installed', { defaultValue: 'Installed' }),
      count: installedCount,
    },
  ]

  return (
    <nav
      className={cn('inline-flex flex-wrap gap-1 rounded-lg border border-border bg-bg-input/50 p-0.5', className)}
      aria-label={t('integrations.hubTabs.label', { defaultValue: 'Connections views' })}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.id}
          to={tab.to}
          end={tab.id === 'discover'}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors',
            active === tab.id
              ? 'bg-bg-surface font-medium text-text-heading shadow-sm'
              : 'text-text-secondary hover:text-text-heading',
          )}
        >
          {tab.label}
          {tab.count != null && tab.count > 0 ? (
            <span className="tabular-nums text-text-muted">{tab.count}</span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  )
}
