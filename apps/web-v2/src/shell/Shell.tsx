import { LogOut, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

import { useDecisions } from '@/api/queries'
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette'
import { useLogout, useMe } from '@/lib/auth'
import { cn } from '@/lib/cn'
import { useRealtime } from '@/lib/realtime'

import { SURFACES } from './surfaces'

export { SURFACES } from './surfaces'

export function Shell() {
  const { t } = useTranslation()
  const me = useMe()
  const logout = useLogout()
  const palette = useCommandPalette()
  const decisions = useDecisions()
  useRealtime()

  return (
    <div className="flex h-full bg-bg-root text-text-primary">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border/60 bg-bg-sidebar">
        <div className="flex h-14 items-center gap-2 px-4">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-accent-fg">B</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-heading">{me.data?.workspace.name ?? t('app.name')}</div>
            {me.data && <div className="truncate text-2xs text-text-muted">{me.data.email}</div>}
          </div>
        </div>
        <div className="px-2 pb-1">
          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-bg-input px-2.5 py-1.5 text-xs text-text-muted hover:border-border"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">{t('nav.search')}</span>
            <kbd className="chip font-mono">⌘K</kbd>
          </button>
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
              <span className="flex-1">{t(`nav.${key}`)}</span>
              {key === 'communication' && (decisions.data?.length ?? 0) > 0 && (
                <span className="rounded-full bg-ai/20 px-1.5 text-2xs font-semibold text-ai-ink" title={t('overview.decisions')}>
                  {decisions.data!.length}
                </span>
              )}
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
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </div>
  )
}
