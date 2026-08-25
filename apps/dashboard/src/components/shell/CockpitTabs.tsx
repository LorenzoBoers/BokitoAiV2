import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const TABS = [
  { labelKey: 'cockpitTabs.overview', defaultLabel: 'Overview', to: '/cockpit', end: true },
  { labelKey: 'cockpitTabs.activity', defaultLabel: 'Activity', to: '/cockpit/activity', end: false },
  { labelKey: 'cockpitTabs.usage', defaultLabel: 'Usage', to: '/cockpit/usage', end: false },
] as const

/** Inner tab strip for the Cockpit surface (Overview / Activity / Usage). */
export default function CockpitTabs() {
  const { t } = useTranslation('nav')
  return (
    <nav
      className="mb-4 flex items-center gap-1 border-b border-border/60"
      aria-label={t('cockpitTabs.aria', { defaultValue: 'Cockpit sections' })}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
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
