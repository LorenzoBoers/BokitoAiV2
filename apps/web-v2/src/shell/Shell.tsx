import {
  BookOpen,
  Bot,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Plug,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

import { useLogout, useMe } from '@/lib/auth'
import { cn } from '@/lib/cn'

export const SURFACES = [
  { key: 'communication', to: '/communication', icon: MessageSquare },
  { key: 'overview', to: '/overview', icon: LayoutDashboard },
  { key: 'work', to: '/work', icon: Bot },
  { key: 'knowledge', to: '/knowledge', icon: BookOpen },
  { key: 'connections', to: '/connections', icon: Plug },
  { key: 'govern', to: '/govern', icon: ShieldCheck },
  { key: 'settings', to: '/settings', icon: Settings },
] as const

export type SurfaceKey = (typeof SURFACES)[number]['key']

export function Shell() {
  const { t } = useTranslation()
  const me = useMe()
  const logout = useLogout()

  return (
    <div className="flex h-full bg-bg-root text-text-primary">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border/60 bg-bg-sidebar">
        <div className="flex h-14 items-center gap-2 px-4">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-accent-fg">
            B
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-heading">
              {me.data?.workspace.name ?? t('app.name')}
            </div>
            {me.data && <div className="truncate text-2xs text-text-muted">{me.data.email}</div>}
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {SURFACES.map(({ key, to, icon: Icon }) => (
            <NavLink
              key={key}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary',
                  isActive && 'bg-bg-hover text-text-heading',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border/60 p-2">
          <button type="button" className="btn-ghost w-full justify-start" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" />
            {t('nav.logout')}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
