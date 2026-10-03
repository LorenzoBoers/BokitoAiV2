import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useOptionalNavBadges } from '../../context/NavBadgeContext'
import { countForBadgeSlot } from '../../lib/nav-badge-counts'
import {
  PINNED_TABS,
  TAB_GROUPS,
  iconForTab,
  isNewTab,
  markTabSeen,
  pathForTab,
  tabFromPath,
  titleForTab,
  type Tab,
} from '../../lib/navigation'
import ScrollFade from '../ui/ScrollFade'
import { Tip } from '../ui/Tip'
import NavFolder from './NavFolder'
import { NavRowLink } from './NavRow'
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
  const [, setNewBadgeTick] = useState(0)

  // Persist + re-render so temporary "New" badges clear after the area is opened.
  useEffect(() => {
    if (!activeTab) return
    if (!isNewTab(activeTab)) return
    markTabSeen(activeTab)
    setNewBadgeTick((n) => n + 1)
  }, [activeTab])

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
    if (tab === 'agents') return countForBadgeSlot(counts, 'agents')
    return 0
  }

  const isTabActive = (tab: Tab) => {
    if (activeTab === tab) return true
    if (tab === 'knowledge') {
      return (
        pathname.startsWith('/knowledge') || pathname.startsWith('/workspace') || pathname.startsWith('/skills')
      )
    }
    return false
  }

  const renderTab = (tab: Tab) => {
    const badge = badgeForTab(tab)
    const showNew = isNewTab(tab)
    const newLabel = t('tabs.modules.newBadge', { defaultValue: 'New' })
    return (
      <NavRowLink
        key={tab}
        to={pathForTab(tab)}
        onClick={onNavigate}
        icon={iconForTab(tab)}
        label={tabTitle(tab)}
        iconOnly={collapsed}
        active={isTabActive(tab)}
        count={badge}
        unread={badge > 0}
        trailing={
          showNew && !collapsed ? (
            <span className="rounded-sm border border-border/70 px-1 text-2xs font-medium text-text-secondary">
              {newLabel}
            </span>
          ) : undefined
        }
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
      <ScrollFade className={collapsed ? 'px-2 py-1' : 'px-2 py-1'}>
        <nav className={`flex flex-col ${collapsed ? 'items-center gap-1' : 'gap-3'}`}>
          {PINNED_TABS.length > 0 ? (
            <section data-tour="nav-pinned" className={collapsed ? 'flex flex-col items-center gap-1' : 'space-y-px'}>
              {PINNED_TABS.map(renderTab)}
            </section>
          ) : null}
          {TAB_GROUPS.map((group) => {
            const open = !(collapsedGroups[group.label] ?? false)
            const hasHeader = group.tabs.length > 1 && !collapsed
            return (
              <NavFolder
                key={group.label}
                label={t(`tabGroups.${group.label.toLowerCase()}`, { defaultValue: group.label })}
                open={open}
                onToggle={() => toggleGroup(group.label)}
                flat={!hasHeader}
                className={collapsed ? 'flex flex-col items-center gap-1' : undefined}
                data-tour={group.label === 'AI' ? 'nav-group-ai' : undefined}
              >
                {group.tabs.map(renderTab)}
              </NavFolder>
            )
          })}
        </nav>
      </ScrollFade>

      {/* Footer: account row */}
      <div className={`shrink-0 border-t border-border/60 ${collapsed ? 'flex justify-center py-1.5' : 'px-1.5 py-1.5'}`}>
        <SidebarUserMenu collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </div>
  )
}
