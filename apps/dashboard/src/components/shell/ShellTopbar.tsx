import { Bell, Building2, ChevronDown, LogOut, Menu, Search, UserCircle2 } from 'lucide-react'
import { useLocation, useNavigate, NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { buildControlPlaneUrl } from '../../lib/host-routing'
import { tabFromPath, titleForTab } from '../../lib/navigation'
import { UserAvatar } from '../ui/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import StaffTenantBar from '../layout/StaffTenantBar'

type ShellTopbarProps = {
  onOpenNavDrawer: () => void
  onOpenPalette: () => void
}

export default function ShellTopbar({ onOpenNavDrawer, onOpenPalette }: ShellTopbarProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { currentWorkspace, workspaces, switchWorkspace } = useWorkspace()
  const tab = tabFromPath(pathname)
  const pageTitle = tab ? titleForTab(tab) : 'Bokito'
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  const goToWorkspacesHub = () => {
    // On a tenant subdomain the hub lives on the control-plane host, so cross-navigate
    // there. Same-origin (app host / loopback dev) stays a client-side route change.
    const controlPlaneUrl = buildControlPlaneUrl('/workspaces')
    if (controlPlaneUrl && typeof window !== 'undefined') {
      try {
        if (new URL(controlPlaneUrl).origin !== window.location.origin) {
          window.location.assign(controlPlaneUrl)
          return
        }
      } catch {
        /* fall through to client-side navigation */
      }
    }
    navigate('/workspaces')
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/40 bg-bg-sidebar/60 pl-3 pr-3">
      <button
        type="button"
        onClick={onOpenNavDrawer}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={16} />
      </button>

      {/* Breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
        <NavLink to="/overview" className="shrink-0 font-semibold text-text-heading hover:text-accent">
          Bokito
        </NavLink>
        {currentWorkspace ? (
          <>
            <span className="shrink-0 text-text-muted/60">/</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  <span className="min-w-0 truncate">{currentWorkspace.name}</span>
                  <ChevronDown size={12} className="shrink-0 text-text-muted" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
                {workspaces.map((workspace) => (
                  <DropdownMenuItem
                    key={workspace.id}
                    onClick={() => {
                      if (workspace.id !== currentWorkspace.id) void switchWorkspace(workspace.id)
                    }}
                    className={workspace.id === currentWorkspace.id ? 'bg-bg-hover text-text-primary' : undefined}
                  >
                    <Building2 size={14} className="mr-2 text-text-muted" />
                    <span className="truncate">{workspace.name}</span>
                    {workspace.id === currentWorkspace.id ? (
                      <span className="ml-auto text-xs text-text-muted">current</span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={goToWorkspacesHub}>
                  <Building2 size={14} className="mr-2 text-text-muted" />
                  All workspaces
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
        <span className="shrink-0 text-text-muted/60">/</span>
        <span className="min-w-0 truncate text-text-primary">{pageTitle}</span>
      </div>

      <StaffTenantBar />

      {/* Search / command palette trigger */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="hidden items-center gap-2 rounded-lg border border-border/60 bg-bg-elevated/60 px-3 py-1.5 text-[12px] text-text-muted transition-colors hover:border-border hover:text-text-secondary sm:flex"
        title="Open command palette"
      >
        <Search size={12} />
        <span>Search</span>
        <kbd className="rounded border border-border/60 bg-bg/60 px-1 font-mono text-[10px] text-text-muted">
          {isMac ? 'Cmd' : 'Ctrl'} K
        </kbd>
      </button>
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary sm:hidden"
        aria-label="Search"
      >
        <Search size={15} />
      </button>

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full transition-opacity hover:opacity-80"
            aria-label="Open user menu"
          >
            <UserAvatar name={user?.name ?? 'Account'} email={user?.email ?? ''} avatarUrl={user?.avatarUrl} size={30} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="truncate">{user?.name ?? 'Account'}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => navigate('/settings/profile')}>
            <UserCircle2 size={14} className="mr-2 text-text-muted" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/settings/notifications')}>
            <Bell size={14} className="mr-2 text-text-muted" />
            Notifications
          </DropdownMenuItem>
          <DropdownMenuItem onClick={goToWorkspacesHub}>
            <Building2 size={14} className="mr-2 text-text-muted" />
            Workspaces
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut size={14} className="mr-2 text-text-muted" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
