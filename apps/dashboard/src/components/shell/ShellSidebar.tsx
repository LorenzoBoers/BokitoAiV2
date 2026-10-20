import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PanelLeftClose, PanelLeftOpen, SquarePen } from 'lucide-react'
import { useOptionalNavBadges } from '../../context/NavBadgeContext'
import { countForBadgeSlot } from '../../lib/nav-badge-counts'
import {
  FOOTER_TAB,
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

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* Header: workspace switcher + collapse */}
      <div
        className={`flex shrink-0 items-center ${
          collapsed ? 'flex-col gap-1 px-0 pb-1 pt-2' : 'h-11 gap-1 pl-2 pr-1.5'
        }`}
      >
        <SidebarWorkspaceSwitcher collapsed={collapsed} onNavigate={onNavigate} />
        <Tip label={collapsed ? t('topbar.expandNavigation') : t('topbar.collapseNavigation')} side="right">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t('topbar.expandNavigation') : t('topbar.collapseNavigation')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover/70 hover:text-text-primary"
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </Tip>
      </div>

      {/* Body */}
      <ScrollFade className="px-2 py-1">
        <nav className={`flex flex-col ${collapsed ? 'items-center gap-1' : 'gap-3'}`}>
          <NavRowLink
            to={newConversationPath()}
            onClick={() => onNavigate?.()}
            icon={SquarePen}
            label={t('tabs.newChat.title', { defaultValue: 'New conversation' })}
            iconOnly={collapsed}
            active={pathname === '/new' || pathname.startsWith('/communication/new')}
            className="nav-row-accent"
            data-tour="nav-newChat"
          />
          {TAB_GROUPS.map((group) => {
            const open = !(collapsedGroups[group.label] ?? false)
            return (
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
              </NavFolder>
            )
          })}
        </nav>
      </ScrollFade>

      {/* Footer: Settings + account row */}
      <div
        className={`shrink-0 border-t border-border/60 ${
          collapsed ? 'flex flex-col items-center gap-1 py-1.5' : 'space-y-px px-1.5 py-1.5'
        }`}
      >
        {renderTab(FOOTER_TAB)}
        <SidebarUserMenu collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </div>
  )
}
