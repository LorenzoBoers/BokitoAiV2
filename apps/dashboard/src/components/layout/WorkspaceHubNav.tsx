import { LayoutGrid, UserCircle2 } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'

function navItemClass(isActive: boolean) {
  return `flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
    isActive
      ? 'border-accent/35 bg-accent/12 text-text-heading'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/60 hover:text-text-primary'
  }`
}

export default function WorkspaceHubNav() {
  const { t } = useTranslation('workspaces')
  const { user } = useAuth()
  const displayName = user?.name || t('account.sidebar.fallbackName')
  const email = user?.email || t('account.sidebar.fallbackEmail')
  const initials = displayName
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col px-4 py-4">
      <div className="flex items-center gap-2.5 px-3 pb-4">
        <img src="/bokito-logo.svg" alt="Bokito" className="h-6 w-6 opacity-90" />
        <span className="text-[15px] font-semibold text-text-heading">Bokito portal</span>
      </div>
      <nav className="space-y-1">
        <NavLink to="/" end className={({ isActive }) => navItemClass(isActive)}>
          <LayoutGrid size={15} className="text-text-muted" />
          <span>{t('nav.workspaces')}</span>
        </NavLink>
      </nav>

      <div className="mt-auto border-t border-border/60 pt-3">
        <NavLink to="/account" className={({ isActive }) => navItemClass(isActive)}>
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-hover/70 text-[11px] font-semibold text-text-primary">
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-text-heading">{displayName}</span>
            <span className="block truncate text-xs text-text-muted">{email}</span>
          </span>
          <UserCircle2 size={14} className="shrink-0 text-text-muted" />
        </NavLink>
      </div>
    </aside>
  )
}
