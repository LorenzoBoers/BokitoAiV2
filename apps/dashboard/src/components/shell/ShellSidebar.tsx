import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { useOptionalNavBadges } from '../../context/NavBadgeContext'
import { countForBadgeSlot } from '../../lib/nav-badge-counts'
import { APP_VERSION } from '../../lib/app-version'
import {
  TAB_GROUPS,
  iconForTab,
  isNewTab,
  pathForTab,
  tabFromPath,
  titleForTab,
  type Tab,
} from '../../lib/navigation'
import { useWorkspace } from '../../context/WorkspaceContext'
import {
  DEFAULT_BRAND_MARK,
  resolveBrandIconUrl,
  workspaceBrandName,
} from '../../lib/tenant-branding'
import ConnectionStatus from './ConnectionStatus'
import ThemeModeToggle from './ThemeModeToggle'

const BOKITO_MARK_FILTER_DARK =
  'brightness(0) saturate(100%) invert(98%) sepia(2%) saturate(1312%) hue-rotate(188deg) brightness(112%) contrast(93%)'
const BOKITO_MARK_FILTER_LIGHT =
  'brightness(0) saturate(100%) invert(53%) sepia(9%) saturate(428%) hue-rotate(183deg) brightness(91%) contrast(88%)'

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
  const { isDark } = useTheme()
  const { currentWorkspace } = useWorkspace()
  const { counts } = useOptionalNavBadges()
  const brandName = workspaceBrandName(currentWorkspace)
  const brandIconUrl = resolveBrandIconUrl(currentWorkspace)
  const brandMarkSrc = brandIconUrl || DEFAULT_BRAND_MARK
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
    if (tab === 'agents') return countForBadgeSlot(counts, 'agents')
    return 0
  }

  return (
    <div className="flex h-full flex-col bg-bg-sidebar">
      {/* Brand header */}
      <div className={`flex shrink-0 items-center border-b border-border/40 ${collapsed ? 'h-auto flex-col justify-center gap-1 px-0 py-2' : 'h-14 justify-between pl-4 pr-2'}`}>
        {!collapsed ? (
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5" onClick={onNavigate}>
            <img
              src={brandMarkSrc}
              alt=""
              className="h-6 w-6 shrink-0 rounded-md object-contain"
              style={
                brandIconUrl
                  ? undefined
                  : { filter: isDark ? BOKITO_MARK_FILTER_DARK : BOKITO_MARK_FILTER_LIGHT }
              }
            />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-text-muted">{t('topbar.controlBrand')}</span>
              <span className="truncate text-[14px] font-semibold text-text-heading">{brandName}</span>
            </span>
          </NavLink>
        ) : (
          <NavLink to="/" className="flex items-center justify-center" onClick={onNavigate} title={brandName}>
            <img
              src={brandMarkSrc}
              alt={brandName}
              className="h-6 w-6 shrink-0 rounded-md object-contain"
              style={
                brandIconUrl
                  ? undefined
                  : { filter: isDark ? BOKITO_MARK_FILTER_DARK : BOKITO_MARK_FILTER_LIGHT }
              }
            />
          </NavLink>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? t('topbar.expandNavigation') : t('topbar.collapseNavigation')}
          aria-label={collapsed ? t('topbar.expandNavigation') : t('topbar.collapseNavigation')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3">
        {/* Nav groups */}
        <nav className="flex flex-col gap-3">
          {TAB_GROUPS.map((group) => {
            const isGroupCollapsed = collapsedGroups[group.label] ?? false
            const showItems = collapsed || !isGroupCollapsed
            return (
              <section
                key={group.label}
                data-tour={group.label === 'AI' ? 'nav-group-ai' : undefined}
              >
                {!collapsed ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label)}
                    className="flex w-full items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted hover:text-text-secondary"
                    aria-expanded={showItems}
                  >
                    <span>{t(`tabGroups.${group.label.toLowerCase()}`, { defaultValue: group.label })}</span>
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${!showItems ? '-rotate-90' : ''}`}
                    />
                  </button>
                ) : null}
                {showItems ? (
                  <div className={`mt-0.5 space-y-px ${collapsed ? 'flex flex-col items-center gap-1 space-y-0' : ''}`}>
                    {group.tabs.map((tab) => {
                      const Icon = iconForTab(tab)
                      const active = activeTab === tab
                      const badge = badgeForTab(tab)
                      const showNew = isNewTab(tab)
                      // Knowledge carries the violet brain identity, also in the rail.
                      const activeClass =
                        tab === 'knowledge'
                          ? 'bg-violet-500/10 font-medium text-violet-500 shadow-[inset_2px_0_0_0_rgb(139,92,246)] dark:text-violet-300'
                          : 'bg-accent/12 font-medium text-accent shadow-[inset_2px_0_0_0_rgb(var(--color-accent))]'
                      return (
                        <NavLink
                          key={tab}
                          to={pathForTab(tab)}
                          onClick={onNavigate}
                          title={tabTitle(tab)}
                          aria-label={tabTitle(tab)}
                          data-tour={`nav-${tab}`}
                          className={`relative flex items-center rounded-lg text-[13px] transition-[background-color,color,box-shadow] duration-200 ${
                            collapsed ? 'h-9 w-9 justify-center' : 'gap-2.5 px-2.5 py-[7px]'
                          } ${
                            active
                              ? activeClass
                              : 'text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary'
                          }`}
                        >
                          <Icon size={15} className="shrink-0" />
                          {!collapsed ? (
                            <>
                              <span className="min-w-0 flex-1 truncate">{tabTitle(tab)}</span>
                              {showNew ? (
                                <span className="ml-auto shrink-0 rounded-md bg-accent/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent">
                                  {t('tabs.modules.newBadge', { defaultValue: 'New' })}
                                </span>
                              ) : badge > 0 ? (
                                <span className="count-pop ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent/15 px-1.5 py-px text-[10px] font-semibold text-accent">
                                  {badge > 99 ? '99+' : badge}
                                </span>
                              ) : null}
                            </>
                          ) : showNew ? (
                            <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" title={t('tabs.modules.newBadge', { defaultValue: 'New' })} />
                          ) : badge > 0 ? (
                            <span className="pulse-dot absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
                          ) : null}
                        </NavLink>
                      )
                    })}
                  </div>
                ) : null}
              </section>
            )
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className={`shrink-0 border-t border-border/40 px-3 py-2.5 ${collapsed ? 'flex flex-col items-center gap-2' : 'space-y-2'}`}>
        <ThemeModeToggle compact={collapsed} />
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed ? (
            <span className="text-[10px] text-text-muted" title={`build ${APP_VERSION}`}>
              v{APP_VERSION}
            </span>
          ) : null}
          <ConnectionStatus showLabel={!collapsed} />
        </div>
      </div>
    </div>
  )
}
