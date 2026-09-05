import { LayoutGrid, LogOut, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { UserAvatar } from '../ui/UserAvatar'

function navItemClass(isActive: boolean) {
  return `flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
    isActive
      ? 'border-accent/35 bg-accent/12 text-text-heading'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/60 hover:text-text-primary'
  }`
}

export default function WorkspaceHubNav() {
  const { t } = useTranslation('workspaces')
  const { user, logout } = useAuth()
  const displayName = user?.name || t('account.sidebar.fallbackName')
  const email = user?.email || t('account.sidebar.fallbackEmail')

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col px-4 py-4">
      <div className="flex items-center gap-2.5 px-3 pb-4">
        <img src="/bokito-logo.svg" alt="Bokito" className="h-6 w-6 opacity-90" />
        <span className="text-[15px] font-semibold text-text-heading">Bokito portal</span>
      </div>
      <nav className="space-y-1">
        <NavLink to="/workspaces" className={({ isActive }) => navItemClass(isActive)}>
          <LayoutGrid size={15} className="text-text-muted" />
          <span>{t('nav.workspaces')}</span>
        </NavLink>
        <NavLink to="/account" className={({ isActive }) => navItemClass(isActive)}>
          <Settings size={15} className="text-text-muted" />
          <span>{t('nav.settings')}</span>
        </NavLink>
      </nav>

      <div className="mt-auto flex items-center gap-1 border-t border-border/60 pt-3">
        <NavLink
          to="/account"
          title={t('nav.account')}
          className={({ isActive }) => `min-w-0 flex-1 ${navItemClass(isActive)}`}
        >
          <UserAvatar
            name={displayName}
            email={email}
            avatarUrl={user?.avatarUrl}
            size={28}
            decorative
            className="rounded-md"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-text-heading">{displayName}</span>
            <span className="block truncate text-xs text-text-muted">{email}</span>
          </span>
        </NavLink>
        <button
          type="button"
          onClick={() => void logout()}
          title={t('account.session.signOut')}
          aria-label={t('account.session.signOut')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  )
}
