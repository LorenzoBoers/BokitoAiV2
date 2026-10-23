import { Button } from '../ui/button'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, PanelLeftClose, PanelLeftOpen, SquarePen } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useOptionalNavBadges } from '../../context/NavBadgeContext'
import { countForBadgeSlot } from '../../lib/nav-badge-counts'
import { platformIcon } from '../../lib/platform-icons'
import { DEPARTMENTS_CHANGED_EVENT, listNavDepartments, type DepartmentNavRow } from '../../lib/teams-api'
import {
  FOOTER_TABS,
  PINNED_TABS,
  TAB_GROUPS,
  iconForTab,
  pathForTab,
  tabFromPath,
  titleForTab,
  type Tab,
} from '../../lib/navigation'
import ScrollFade from '../ui/ScrollFade'
import { Tip } from '../ui/Tip'
import NavFolder from './NavFolder'
import { NavRowLink } from './NavRow'
import { newConversationPath } from '../../lib/messages-paths'
import SidebarUserMenu from './SidebarUserMenu'
import SidebarWorkspaceSwitcher from './SidebarWorkspaceSwitcher'

const GROUPS_COLLAPSED_KEY = 'bokito-nav-groups-collapsed'

function loadCollapsedGroups(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_COLLAPSED_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

type ShellSidebarProps = {
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Called after a navigation happens (used to close the mobile drawer). */
  onNavigate?: () => void
}

export default function ShellSidebar({ collapsed, onToggleCollapsed, onNavigate }: ShellSidebarProps) {
  const { pathname } = useLocation()
  const { t } = useTranslation('nav')
  const { counts } = useOptionalNavBadges()
  const activeTab = tabFromPath(pathname)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(loadCollapsedGroups)
  const { token } = useAuth()
  const [departments, setDepartments] = useState<DepartmentNavRow[]>([])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const load = () => {
      void listNavDepartments(token)
        .then((rows) => {
          if (!cancelled) setDepartments(rows)
        })
        .catch(() => undefined)
    }
    load()
    window.addEventListener(DEPARTMENTS_CHANGED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(DEPARTMENTS_CHANGED_EVENT, load)
    }
  }, [token])

  const tabTitle = (tab: Tab) => t(`tabs.${tab}.title`, { defaultValue: titleForTab(tab) })

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] }
      try {
        localStorage.setItem(GROUPS_COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        // ignore storage failures
      }
      return next
    })
  }

  const badgeForTab = (tab: Tab): number => {
    if (tab === 'communication') return countForBadgeSlot(counts, 'inbox')
    if (tab === 'agenda') return countForBadgeSlot(counts, 'agenda')
    return 0
  }

  const renderTab = (tab: Tab) => {
    const badge = badgeForTab(tab)
    return (
      <NavRowLink
        key={tab}
        to={pathForTab(tab)}
        onClick={() => onNavigate?.()}
        icon={iconForTab(tab)}
        label={tabTitle(tab)}
        iconOnly={collapsed}
        active={activeTab === tab}
        count={badge}
        unread={badge > 0}
        data-tour={`nav-${tab}`}
      />
    )
  }

  const renderDepartments = () => {
    if (departments.length === 0) return null
    const label = 'departments'
    return (
      <NavFolder
        key={label}
        label={t(`tabGroups.${label}`, { defaultValue: 'Departments' })}
        open={!(collapsedGroups[label] ?? false)}
        onToggle={() => toggleGroup(label)}
        flat={collapsed}
        className={collapsed ? 'flex flex-col items-center gap-1' : undefined}
        data-tour={`nav-group-${label}`}
      >
        {departments.map((dept) => (
          <NavRowLink
            key={dept.id}
            to={dept.href}
            onClick={() => onNavigate?.()}
            icon={platformIcon(dept.icon) ?? Building2}
            label={dept.name}
            iconOnly={collapsed}
            active={pathname.startsWith(dept.href)}
            count={dept.open}
            className="nav-row-accent"
            data-tour="nav-department"
          />
        ))}
      </NavFolder>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg-sidebar">
      {/* Header: workspace switcher + collapse */}
      <div
        className={`flex shrink-0 items-center ${
          collapsed ? 'flex-col gap-1 px-0 pb-1 pt-2' : 'h-11 gap-1 pl-2 pr-1.5'
        }`}
      >
        <SidebarWorkspaceSwitcher collapsed={collapsed} onNavigate={onNavigate} />
        <Tip label={collapsed ? t('topbar.expandNavigation') : t('topbar.collapseNavigation')} side="right">
          <Button variant="ghost" size="iconSm"
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t('topbar.expandNavigation') : t('topbar.collapseNavigation')}
            className="shrink-0 text-text-muted"
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </Button>
        </Tip>
      </div>

      {/* Body */}
      <ScrollFade className="px-2 py-1">
        <nav className={`flex flex-col ${collapsed ? 'items-center gap-1' : 'gap-3'}`}>
          <NavRowLink
            to={newConversationPath()}
            onClick={() => onNavigate?.()}
            icon={SquarePen}
            label={t('tabs.newChat.title', { defaultValue: 'New chat' })}
            tipDetail="N"
            iconOnly={collapsed}
            active={pathname === '/new' || pathname.startsWith('/communication/new')}
            className="nav-row-accent"
            data-tour="nav-newChat"
          />
          {PINNED_TABS.map(renderTab)}
          {TAB_GROUPS.map((group) => {
            const open = !(collapsedGroups[group.label] ?? false)
            return [
              group.label === 'team' ? renderDepartments() : null,
              <NavFolder
                key={group.label}
                label={t(`tabGroups.${group.label}`, { defaultValue: group.label })}
                open={open}
                onToggle={() => toggleGroup(group.label)}
                flat={collapsed}
                className={collapsed ? 'flex flex-col items-center gap-1' : undefined}
                data-tour={`nav-group-${group.label}`}
              >
                {group.tabs.map(renderTab)}
              </NavFolder>,
            ]
          })}
        </nav>
      </ScrollFade>

      {/* Settings above the divider (same pattern as Bin in settings nav). */}
      <div
        className={`shrink-0 ${
          collapsed ? 'flex flex-col items-center px-0 pb-1' : 'px-2 pb-1'
        }`}
      >
        {FOOTER_TABS.map(renderTab)}
      </div>

      {/* Footer: account row */}
      <div
        className={`shrink-0 ${
          collapsed ? 'flex flex-col items-center gap-1 py-1.5' : 'space-y-px px-1.5 py-1.5'
        }`}
      >
        <SidebarUserMenu collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </div>
  )
}
