import { Building2, Check, ChevronsUpDown, LayoutGrid, Gauge } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../context/ThemeContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { buildControlPlaneUrl } from '../../lib/host-routing'
import { REPORTS_PATH } from '../../lib/navigation'
import { DEFAULT_BRAND_MARK, resolveBrandIconUrl, workspaceBrandName, BOKITO_MARK_FILTER_DARK, BOKITO_MARK_FILTER_LIGHT } from '../../lib/tenant-branding'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tip } from '../ui/Tip'

/** Navigates to the workspaces hub, cross-host when running on a tenant subdomain. */
export function useGoToWorkspacesHub() {
  const navigate = useNavigate()
  return () => {
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
}

type SidebarWorkspaceSwitcherProps = {
  collapsed: boolean
  onNavigate?: () => void
}

/**
 * Rail header: brand mark + workspace name that opens the workspace menu.
 * Replaces the old topbar switcher; collapsed rail shows the mark only.
 */
export default function SidebarWorkspaceSwitcher({ collapsed, onNavigate }: SidebarWorkspaceSwitcherProps) {
  const { t } = useTranslation('nav')
  const { isDark } = useTheme()
  const navigate = useNavigate()
  const goToWorkspacesHub = useGoToWorkspacesHub()
  const { currentWorkspace, workspaces, switchWorkspace } = useWorkspace()
  const brandName = workspaceBrandName(currentWorkspace)
  const brandIconUrl = resolveBrandIconUrl(currentWorkspace)
  const markSrc = brandIconUrl || DEFAULT_BRAND_MARK
  const markStyle = brandIconUrl
    ? undefined
    : { filter: isDark ? BOKITO_MARK_FILTER_DARK : BOKITO_MARK_FILTER_LIGHT }

  const mark = (
    <img src={markSrc} alt="" className="h-5 w-5 shrink-0 rounded object-contain" style={markStyle} />
  )

  if (!currentWorkspace) {
    return (
      <Tip label={brandName} side="right">
        <NavLink
          to="/"
          onClick={onNavigate}
          className={`flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm font-medium text-text-heading hover:bg-bg-hover/70 ${
            collapsed ? 'w-8 justify-center px-0' : ''
          }`}
        >
          {mark}
          {collapsed ? null : <span className="min-w-0 flex-1 truncate-fade">{brandName}</span>}
        </NavLink>
      </Tip>
    )
  }

  return (
    <DropdownMenu>
      <Tip label={collapsed ? brandName : undefined} side="right">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('topbar.switchWorkspace')}
            className={`flex h-8 min-w-0 items-center gap-2 rounded-md text-sm font-medium text-text-heading transition-colors hover:bg-bg-hover/70 data-[state=open]:bg-bg-hover ${
              collapsed ? 'w-8 justify-center px-0' : 'flex-1 px-1.5'
            }`}
          >
            {mark}
            {collapsed ? null : (
              <>
                <span className="min-w-0 flex-1 truncate-fade text-left">{brandName}</span>
                <ChevronsUpDown size={12} className="shrink-0 text-text-muted" aria-hidden />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" sideOffset={6} className="w-60">
        <DropdownMenuLabel>{t('topbar.switchWorkspace')}</DropdownMenuLabel>
        {workspaces.map((workspace) => {
          const current = workspace.id === currentWorkspace.id
          return (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => {
                if (!current) void switchWorkspace(workspace.id)
                onNavigate?.()
              }}
              className={current ? 'text-text-heading' : undefined}
            >
              <Building2 size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate-fade">{workspace.name}</span>
              {current ? <Check size={14} className="ml-auto shrink-0 text-text-muted" aria-hidden /> : null}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            navigate(REPORTS_PATH)
            onNavigate?.()
          }}
        >
          <Gauge size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
          {t('tabs.overview.title', { defaultValue: 'Overview' })}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            goToWorkspacesHub()
            onNavigate?.()
          }}
        >
          <LayoutGrid size={14} className="mr-2 shrink-0 text-text-muted" aria-hidden />
          {t('topbar.allWorkspaces')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
