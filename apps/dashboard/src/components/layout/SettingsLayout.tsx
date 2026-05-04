import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

const settingsLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-200 border-0 font-inherit motion-reduce:transition-none ${
    isActive
      ? 'text-accent'
      : 'text-text-secondary hover:text-text-primary'
  }`

const settingsSoonClass =
  'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] text-text-muted/70 cursor-default border-0 font-inherit'

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <p className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </p>
      <nav className="space-y-0.5">{children}</nav>
    </div>
  )
}

export default function SettingsLayout() {
  return (
    <div className="h-full min-h-0 flex gap-0">
      <aside className="w-[212px] flex-shrink-0 border-r border-border/50 pr-3 pt-4">
        <h1 className="px-2.5 mb-4 text-[14px] font-semibold text-text-heading">Instellingen</h1>
        <SettingsSection title="Communicatie">
          <NavLink to="/settings/email" className={settingsLinkClass}>
            Email
          </NavLink>
          <NavLink to="/settings/inbox" className={settingsLinkClass}>
            Inbox
          </NavLink>
        </SettingsSection>
        <SettingsSection title="Integraties">
          <NavLink to="/settings/integrations" className={settingsLinkClass}>
            Verbonden tools
          </NavLink>
          <NavLink to="/settings/mcp" className={settingsLinkClass}>
            MCP Servers
          </NavLink>
          <button type="button" className={settingsSoonClass} disabled>
            API-sleutels
          </button>
          <button type="button" className={settingsSoonClass} disabled>
            Webhooks
          </button>
        </SettingsSection>
        <SettingsSection title="Workspace">
          <NavLink to="/settings/workspace" className={settingsLinkClass}>
            Algemeen
          </NavLink>
          <NavLink to="/settings/members" className={settingsLinkClass}>
            Leden
          </NavLink>
          <NavLink to="/settings/usage" className={settingsLinkClass}>
            Gebruik & limieten
          </NavLink>
          <NavLink to="/settings/audit" className={settingsLinkClass}>
            Audit log
          </NavLink>
        </SettingsSection>
        <SettingsSection title="Mijn organisatie">
          <NavLink to="/settings/company-config" className={settingsLinkClass}>
            Configuratie
          </NavLink>
          <button type="button" className={settingsSoonClass} disabled>
            Kennisbank
          </button>
        </SettingsSection>
        <SettingsSection title="Account">
          <NavLink to="/settings/profile" className={settingsLinkClass}>
            Profiel & 2FA
          </NavLink>
        </SettingsSection>
      </aside>
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden pl-0.5">
        <Outlet />
      </div>
    </div>
  )
}
