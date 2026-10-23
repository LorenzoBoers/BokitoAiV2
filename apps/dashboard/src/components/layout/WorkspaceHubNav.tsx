import { LayoutGrid, LogOut, Settings } from 'lucide-react'
import { Button } from '../ui/button'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { DEFAULT_BRAND_MARK } from '../../lib/tenant-branding'
import { Avatar } from '../ui/avatar'

function navItemClass(isActive: boolean) {
  return `flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
    isActive
      ? 'border-accent/35 bg-accent/12 text-text-heading'
      : 'border-transparent text-text-secondary hover:border-border hover:bg-bg-hover hover:text-text-primary'
  }`
}

export default function WorkspaceHubNav() {
  const { t } = useTranslation('workspaces')
  const { user, logout } = useAuth()
  const displayName = user?.name || t('account.sidebar.fallbackName')
  const email = user?.email || t('account.sidebar.fallbackEmail')

  return (
    <aside className="flex h-full w-rail shrink-0 flex-col px-4 py-4">
      <div className="flex items-center gap-2.5 px-3 pb-4">
        <img
          src={DEFAULT_BRAND_MARK}
          alt="Bokito"
          className="h-6 w-6 rounded-full object-contain"
        />
        <span className="text-lg font-semibold text-text-heading">Bokito portal</span>
      </div>
      <nav className="space-y-1">
        <NavLink to="/workspaces" className={({ isActive }) => navItemClass(isActive)}>
          <LayoutGrid size={16} className="text-text-muted" />
          <span>{t('nav.workspaces')}</span>
        </NavLink>
        <NavLink to="/account" className={({ isActive }) => navItemClass(isActive)}>
          <Settings size={16} className="text-text-muted" />
          <span>{t('nav.settings')}</span>
        </NavLink>
      </nav>

      <div className="mt-auto flex items-center gap-1 border-t border-border pt-3">
        <NavLink
          to="/account"
          title={t('nav.account')}
          className={({ isActive }) => `min-w-0 flex-1 ${navItemClass(isActive)}`}
        >
          <Avatar
            kind="person"
            name={displayName}
            email={email}
            imageUrl={user?.avatarUrl}
            size={32}
            decorative
            className="rounded-md"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate-fade text-sm text-text-heading">{displayName}</span>
            <span className="block truncate-fade text-xs text-text-muted">{email}</span>
          </span>
        </NavLink>
        <Button variant="ghost" size="icon"
          type="button"
          onClick={() => void logout()}
          title={t('account.session.signOut')}
          aria-label={t('account.session.signOut')}
          className="shrink-0"
        >
          <LogOut size={16} />
        </Button>
      </div>
    </aside>
  )
}
