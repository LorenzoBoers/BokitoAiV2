import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ContentHeader from './ContentHeader'
import { ASSISTENT_DEFAULT_PATH } from '../../lib/assistent-settings-path'

type SettingsLink = { label: string; to: string; match?: string }
type SettingsGroup = { label: string; links: SettingsLink[] }

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Personal',
    links: [
      { label: 'Profile', to: '/settings/profile' },
      { label: 'My assistant', to: '/settings/assistant' },
      { label: 'Notifications', to: '/settings/notifications' },
      { label: 'Access & security', to: '/settings/access-security' },
    ],
  },
  {
    label: 'Workspace',
    links: [
      { label: 'General', to: '/settings/general' },
      { label: 'Projects', to: '/settings/projects' },
      { label: 'Branding', to: '/settings/branding' },
      { label: 'Members & teams', to: '/settings/members' },
    ],
  },
  {
    label: 'Channels',
    links: [
      { label: 'Email & messages', to: '/settings/channels' },
      { label: 'Assistant widget', to: ASSISTENT_DEFAULT_PATH, match: '/ai/assistent' },
      { label: 'Communication agent', to: '/settings/communication', match: '/settings/communication' },
      { label: 'Knowledge base', to: '/settings/help-centers' },
    ],
  },
  {
    label: 'Integrations',
    links: [
      { label: 'Connected', to: '/settings/integrations' },
      { label: 'Setup guide', to: '/integrations/setup' },
      { label: 'Marketplace', to: '/settings/marketplace' },
      { label: 'MCP', to: '/settings/mcp' },
    ],
  },
  {
    label: 'AI',
    links: [{ label: 'Providers and models', to: '/settings/models' }],
  },
  {
    label: 'Autonomy',
    links: [{ label: 'Autonomy & approvals', to: '/settings/autonomy' }],
  },
]

export default function SettingsLayout() {
  const { pathname } = useLocation()

  return (
    <div>
      <ContentHeader title="Settings" subtitle="Workspace configuration" />
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="shrink-0 lg:w-[200px]" aria-label="Settings sections">
          <div className="flex flex-row flex-wrap gap-x-4 gap-y-3 lg:sticky lg:top-2 lg:flex-col lg:gap-y-5">
            {SETTINGS_GROUPS.map((group) => (
              <section key={group.label} className="min-w-[150px]">
                <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  {group.label}
                </p>
                <div className="space-y-px">
                  {group.links.map((link) => {
                    const active = link.match
                      ? pathname.startsWith(link.match)
                      : pathname === link.to || pathname.startsWith(`${link.to}/`)
                    return (
                      <NavLink
                        key={link.to}
                        to={link.to}
                        className={`block rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors ${
                          active
                            ? 'bg-accent/12 font-medium text-accent'
                            : 'text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary'
                        }`}
                      >
                        {link.label}
                      </NavLink>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
