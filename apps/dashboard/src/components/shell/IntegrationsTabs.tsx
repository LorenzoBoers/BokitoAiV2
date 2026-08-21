import { NavLink } from 'react-router-dom'

const TABS = [
  { label: 'Connected', to: '/settings/integrations' },
  { label: 'Marketplace', to: '/settings/marketplace' },
  { label: 'Connected tools', to: '/settings/mcp' },
] as const

/**
 * Inner tab strip for the unified Integrations surface. One settings entry,
 * three views: what is connected, what can be connected, and MCP tool servers.
 */
export default function IntegrationsTabs() {
  return (
    <nav
      className="mb-4 flex items-center gap-1 border-b border-border/60"
      aria-label="Integrations sections"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
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
