import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ContentHeader from './ContentHeader'
import { ASSISTANT_DEFAULT_PATH } from '../../lib/assistant-settings-path'

type SettingsLink = { label: string; to: string; match?: string | string[] }
type SettingsGroup = { label: string; links: SettingsLink[] }

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Personal',
    links: [
      { label: 'Profile & security', to: '/settings/profile' },
      { label: 'My assistant', to: '/settings/assistant' },
      { label: 'Notifications', to: '/settings/notifications' },
    ],
  },
  {
    label: 'Workspace',
    links: [
      { label: 'General', to: '/settings/general' },
      { label: 'Branding', to: '/settings/branding' },
      { label: 'Members', to: '/settings/members' },
      { label: 'Setup guide', to: '/settings/setup' },
    ],
  },
  {
    label: 'Communication',
    links: [
      { label: 'Email & messages', to: '/settings/channels' },
      { label: 'Chat widget', to: ASSISTANT_DEFAULT_PATH, match: '/ai/assistant' },
      { label: 'Communication agent', to: '/settings/communication', match: '/settings/communication' },
      { label: 'Knowledge base', to: '/settings/help-centers' },
    ],
  },
  {
    label: 'Integrations',
    links: [
      {
        label: 'Integrations',
        to: '/settings/integrations',
        match: ['/settings/integrations', '/settings/marketplace', '/settings/mcp'],
      },
      { label: 'Developers', to: '/settings/developers' },
    ],
  },
  {
    label: 'AI',
    links: [
      { label: 'Providers & models', to: '/settings/models' },
      { label: 'Autonomy & approvals', to: '/settings/autonomy' },
    ],
  },
]

function linkIsActive(pathname: string, link: SettingsLink): boolean {
  if (link.match) {
    const patterns = Array.isArray(link.match) ? link.match : [link.match]
    return patterns.some((pattern) => pathname.startsWith(pattern))
  }
  return pathname === link.to || pathname.startsWith(`${link.to}/`)
}

export default function SettingsLayout() {
  const { pathname } = useLocation()
  const activeLink = SETTINGS_GROUPS.flatMap((group) => group.links).find((link) =>
    linkIsActive(pathname, link),
  )

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border/40 bg-bg-sidebar/50 px-2.5 py-3 lg:flex">
        <p className="px-2.5 pb-3 text-[15px] font-semibold leading-none text-text-heading">Settings</p>
        <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Settings sections">
          <SettingsNav pathname={pathname} />
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <nav
          className="shrink-0 overflow-x-auto border-b border-border/40 bg-bg-sidebar/50 px-3 py-2 lg:hidden"
          aria-label="Settings sections"
        >
          <SettingsNav pathname={pathname} compact />
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5 lg:px-8">
          <ContentHeader title="Settings" subtitle={activeLink?.label ?? 'Workspace configuration'} />
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function SettingsNav({ pathname, compact = false }: { pathname: string; compact?: boolean }) {
  return (
    <div className={compact ? 'flex flex-row flex-wrap gap-x-4 gap-y-2' : 'flex flex-col gap-y-5'}>
      {SETTINGS_GROUPS.map((group) => (
        <section key={group.label} className={compact ? 'min-w-[140px]' : undefined}>
          <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {group.label}
          </p>
          <div className="space-y-px">
            {group.links.map((link) => {
              const active = linkIsActive(pathname, link)
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
  )
}
