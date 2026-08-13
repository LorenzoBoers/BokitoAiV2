import { NavLink } from 'react-router-dom'

const TABS = [
  { label: 'Overview', to: '/cockpit', end: true },
  { label: 'Activity', to: '/cockpit/activity', end: false },
  { label: 'Usage', to: '/cockpit/usage', end: false },
] as const

/** Inner tab strip for the Cockpit surface (Overview / Activity / Usage). */
export default function CockpitTabs() {
  return (
    <nav className="mb-4 flex items-center gap-1 border-b border-border/50" aria-label="Cockpit sections">
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
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
