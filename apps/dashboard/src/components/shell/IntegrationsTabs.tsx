import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const TABS = [
  { labelKey: 'tabs.modules.title', defaultLabel: 'Modules', to: '/modules', end: true },
  { labelKey: 'integrations.pageMeta.connected.title', defaultLabel: 'Connections', to: '/modules/connected' },
  { labelKey: 'integrations.pageMeta.marketplace.title', defaultLabel: 'Marketplace', to: '/modules/marketplace' },
] as const

/**
 * Inner tab strip for the Modules hub: presets, partner logins, and discover.
 */
export default function IntegrationsTabs() {
  const { t } = useTranslation('nav')
  return (
    <nav
      className="mb-4 flex items-center gap-1 border-b border-border/60"
      aria-label={t('integrations.tabsAria', { defaultValue: 'Integrations sections' })}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={'end' in tab ? tab.end : false}
          className={({ isActive }) =>
            `-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors ${
              isActive
                ? 'border-accent text-accent'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`
          }
        >
          {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
        </NavLink>
      ))}
    </nav>
  )
}
