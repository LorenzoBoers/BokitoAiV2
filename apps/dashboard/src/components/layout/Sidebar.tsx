import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  MessageSquare,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Workflow,
  Database,
  Users,
  CheckSquare,
  ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const STORAGE_KEY = 'bokito-sidebar-expanded'
const DEFAULT_SIDEBAR_LOGO = '/bokito-logo.svg'
const CLOSE_DELAY_MS = 400
const FLYOUT_EXIT_MS = 420

type SubItem = { label: string; to: string }

const crmMenu: SubItem[] = [
  { label: 'Klanten', to: '/database/klanten' },
  { label: 'Berichten', to: '/database/berichten' },
  { label: 'Taken', to: '/database/taken' },
]

function readExpanded(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === null) return true
    return v === 'true'
  } catch {
    return true
  }
}

// ─── NavGroup ────────────────────────────────────────────────────────────────

function NavGroup({
  id,
  label,
  icon: Icon,
  items,
  expanded,
  isOpen,
  onEnter,
  onLeave,
}: {
  id: string
  label: string
  icon: React.ElementType
  items: SubItem[]
  expanded: boolean
  isOpen: boolean
  onEnter: (id: string) => void
  onLeave: () => void
}) {
  const location = useLocation()
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(null)
  const [flyoutVisible, setFlyoutVisible] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const flyoutExitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const childActive = items.some((it) => it.to !== '#' && location.pathname === it.to)

  const updateFlyoutPos = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setFlyout({ top: r.top, left: r.right })
  }, [])

  // Flyout lifecycle: mount when opening, delayed unmount for exit animation
  const prevOpenRef = useRef(isOpen)
  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = isOpen

    if (expanded) {
      setFlyout(null)
      setFlyoutVisible(false)
      return
    }

    if (isOpen && !wasOpen) {
      if (flyoutExitTimer.current) clearTimeout(flyoutExitTimer.current)
      updateFlyoutPos()
    }

    if (!isOpen && wasOpen) {
      setFlyoutVisible(false)
      flyoutExitTimer.current = setTimeout(() => setFlyout(null), FLYOUT_EXIT_MS)
    }

    return () => {
      if (flyoutExitTimer.current) clearTimeout(flyoutExitTimer.current)
    }
  }, [isOpen, expanded, updateFlyoutPos])

  // Trigger enter animation after flyout is mounted
  useEffect(() => {
    if (expanded || !flyout || !isOpen) { setFlyoutVisible(false); return }
    const af = requestAnimationFrame(() =>
      requestAnimationFrame(() => setFlyoutVisible(true)),
    )
    return () => cancelAnimationFrame(af)
  }, [flyout, isOpen, expanded])

  // Reposition flyout on scroll/resize
  useEffect(() => {
    if (!isOpen || expanded) return
    const handler = () => updateFlyoutPos()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [isOpen, expanded, updateFlyoutPos])

  const collapsedCls = !expanded ? 'justify-center px-2' : ''

  const subLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex w-full items-center rounded-md px-2.5 py-2 text-left text-[12px] transition-colors duration-200 ease-out border-0 font-inherit motion-reduce:transition-none ${
      isActive
        ? 'text-accent bg-accent/10'
        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
    }`

  const subButtonClass =
    'flex w-full items-center rounded-md px-2.5 py-2 text-left text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors duration-200 ease-out border-0 font-inherit motion-reduce:transition-none'

  const renderSubLinks = () =>
    items.map((item) =>
      item.to === '#' ? (
        <button key={item.label} type="button" className={subButtonClass}>
          {item.label}
        </button>
      ) : (
        <NavLink key={item.label} to={item.to} end={item.to === '/'} className={subLinkClass}>
          {item.label}
        </NavLink>
      ),
    )

  return (
    <div
      className="relative"
      onMouseEnter={() => onEnter(id)}
      onMouseLeave={onLeave}
    >
      {/* Trigger row */}
      <div
        ref={triggerRef}
        className={`nav-item cursor-default select-none transition-[background-color,color] duration-200 ease-out ${collapsedCls} ${
          childActive ? 'active' : ''
        } ${isOpen ? 'bg-bg-hover/60' : ''}`}
        title={!expanded ? label : undefined}
      >
        <Icon size={18} className="flex-shrink-0" />
        {expanded && (
          <>
            <span className="whitespace-nowrap text-[13px] truncate flex-1 text-left">
              {label}
            </span>
            <ChevronRight
              size={14}
              className={`flex-shrink-0 text-text-muted transition-transform duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isOpen ? 'rotate-90' : ''
              }`}
            />
          </>
        )}
      </div>

      {/* Expanded inline submenu — open animates in, close is INSTANT to prevent layout shift */}
      {expanded && (
        <div
          className={`grid motion-reduce:transition-none ${
            isOpen
              ? 'grid-rows-[1fr] transition-[grid-template-rows] duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]'
              : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div
              className={`mt-1 ml-1 pl-2 border-l border-border space-y-1 transition-opacity duration-250 ease-out motion-reduce:transition-none ${
                isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              {renderSubLinks()}
            </div>
          </div>
        </div>
      )}

      {/* Collapsed flyout panel */}
      {!expanded && flyout && (
        <div
          className="fixed z-[100] flex pointer-events-none"
          style={{ top: flyout.top, left: flyout.left }}
        >
          {/* Invisible bridge so mouse doesn't "drop" between sidebar and panel */}
          <div className="w-2 shrink-0 self-stretch pointer-events-auto" aria-hidden />
          <div
            className={`pointer-events-auto space-y-0.5 min-w-[200px] rounded-md border border-border bg-bg-elevated py-1.5 shadow-lg transition-[opacity,transform,box-shadow] duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
              flyoutVisible
                ? 'opacity-100 translate-x-0 shadow-xl'
                : 'opacity-0 -translate-x-2 shadow-md'
            }`}
          >
            {renderSubLinks()}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const settingsActive = location.pathname.startsWith('/settings')
  const [expanded, setExpanded] = useState(readExpanded)
  // Single shared open-group state — no more per-group timers that conflict
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(expanded))
    } catch { /* ignore */ }
  }, [expanded])

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimerRef.current = setTimeout(() => setOpenGroupId(null), CLOSE_DELAY_MS)
  }, [cancelClose])

  const handleGroupEnter = useCallback((id: string) => {
    cancelClose()
    setOpenGroupId(id)
  }, [cancelClose])

  // Close when the cursor leaves the entire nav section
  const handleNavLeave = useCallback(() => {
    scheduleClose()
  }, [scheduleClose])

  const handleNavEnter = useCallback(() => {
    cancelClose()
  }, [cancelClose])

  // Close all when sidebar collapses/expands to avoid stale flyouts
  useEffect(() => { setOpenGroupId(null) }, [expanded])

  const navGroupProps = (id: string, label: string, icon: React.ElementType, items: SubItem[]) => ({
    id,
    label,
    icon,
    items,
    expanded,
    isOpen: openGroupId === id,
    onEnter: handleGroupEnter,
    onLeave: scheduleClose,
  })

  const displayName = user?.name ?? 'Account'
  const tenantName = user?.tenant?.name?.trim() || 'Tenant'
  const tenantSlugFromAuth = user?.tenant?.slug?.trim()
  const tenantSlug =
    tenantSlugFromAuth && tenantSlugFromAuth !== 'unknown'
      ? tenantSlugFromAuth
      : tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const remoteTenantLogo = user?.tenant?.logo?.trim() ?? ''
  const [tenantLogoBroken, setTenantLogoBroken] = useState(false)

  useEffect(() => {
    setTenantLogoBroken(false)
  }, [remoteTenantLogo, user?.id])

  const sidebarLogoSrc =
    !remoteTenantLogo || tenantLogoBroken ? DEFAULT_SIDEBAR_LOGO : remoteTenantLogo

  const initials = displayName
    .split(' ')
    .map((n) => n[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <aside
      className={`bg-bg-sidebar/95 border-r border-border/70 flex flex-col h-full transition-[width] duration-200 ease-out flex-shrink-0 overflow-x-visible overflow-y-hidden min-h-0 ${
        expanded ? 'w-[208px]' : 'w-[56px]'
      }`}
    >
      {/* Logo */}
      <div className="h-12 flex items-center gap-2.5 border-b border-border/70 flex-shrink-0 px-2.5 min-w-0">
        <img
          src={sidebarLogoSrc}
          alt={expanded ? '' : tenantName}
          className="w-8 h-8 flex-shrink-0 object-contain rounded-md"
          onError={() => {
            if (remoteTenantLogo) setTenantLogoBroken(true)
          }}
        />
        {expanded && (
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-text-heading whitespace-nowrap truncate leading-tight">
              {tenantName}
            </span>
            <span className="text-[10px] text-text-muted whitespace-nowrap truncate leading-tight font-mono">
              {tenantSlug || 'tenant'}
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 min-h-0 overflow-y-auto overflow-x-visible px-2 pt-4 pb-2 flex flex-col gap-1"
        onMouseEnter={handleNavEnter}
        onMouseLeave={handleNavLeave}
      >
        <NavLink
          to="/"
          end
          title={!expanded ? 'Dashboard' : undefined}
          className={({ isActive }) =>
            `nav-item ${isActive ? 'active' : ''} ${!expanded ? 'justify-center px-2' : ''}`
          }
        >
          <LayoutDashboard size={18} className="flex-shrink-0" />
          {expanded && (
            <span className="whitespace-nowrap text-[13px] truncate">Dashboard</span>
          )}
        </NavLink>

        <NavLink
          to="/communication"
          title={!expanded ? 'Communicatie' : undefined}
          className={({ isActive }) =>
            `nav-item ${isActive ? 'active' : ''} ${!expanded ? 'justify-center px-2' : ''}`
          }
        >
          <MessageSquare size={18} className="flex-shrink-0" />
          {expanded && (
            <span className="whitespace-nowrap text-[13px] truncate">Communicatie</span>
          )}
        </NavLink>

        <NavLink
          to="/datasources"
          title={!expanded ? 'AI Bronnen' : undefined}
          className={({ isActive }) =>
            `nav-item ${isActive ? 'active' : ''} ${!expanded ? 'justify-center px-2' : ''}`
          }
        >
          <BookOpen size={18} className="flex-shrink-0" />
          {expanded && (
            <span className="whitespace-nowrap text-[13px] truncate">AI Bronnen</span>
          )}
        </NavLink>

        <NavLink
          to="/database"
          title={!expanded ? 'Database' : undefined}
          className={({ isActive }) =>
            `nav-item ${isActive ? 'active' : ''} ${!expanded ? 'justify-center px-2' : ''}`
          }
        >
          <Database size={18} className="flex-shrink-0" />
          {expanded && (
            <span className="whitespace-nowrap text-[13px] truncate">Database</span>
          )}
        </NavLink>

        <NavGroup {...navGroupProps('crm', 'CRM', Users, crmMenu)} />

        <div
          className={`nav-item cursor-default ${!expanded ? 'justify-center px-2' : ''}`}
          title={!expanded ? 'Automatisering' : undefined}
        >
          <Workflow size={18} className="flex-shrink-0" />
          {expanded && (
            <span className="whitespace-nowrap text-[13px] truncate">Automatisering</span>
          )}
        </div>

        <NavLink
          to="/workforce"
          title={!expanded ? 'Workforce' : undefined}
          className={({ isActive }) =>
            `nav-item ${isActive ? 'active' : ''} ${!expanded ? 'justify-center px-2' : ''}`
          }
        >
          <ShieldCheck size={18} className="flex-shrink-0" />
          {expanded && (
            <span className="whitespace-nowrap text-[13px] truncate">Workforce</span>
          )}
        </NavLink>

        <NavLink
          to="/analytics"
          title={!expanded ? 'Analytics' : undefined}
          className={({ isActive }) =>
            `nav-item ${isActive ? 'active' : ''} ${!expanded ? 'justify-center px-2' : ''}`
          }
        >
          <BarChart3 size={18} className="flex-shrink-0" />
          {expanded && (
            <span className="whitespace-nowrap text-[13px] truncate">Analytics</span>
          )}
        </NavLink>
      </nav>

      {/* Toggle + bottom */}
      <div className="border-t border-border flex-shrink-0">
        <div className="px-2 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? 'Zijbalk inklappen' : 'Zijbalk uitklappen'}
            title={expanded ? 'Inklappen' : 'Uitklappen'}
          >
            {expanded ? (
              <>
                <ChevronLeft size={18} className="flex-shrink-0" />
                <span className="text-xs font-medium whitespace-nowrap">Inklappen</span>
              </>
            ) : (
              <ChevronRight size={18} className="flex-shrink-0" />
            )}
          </button>
        </div>
        <div className="px-2 pb-2 flex flex-col gap-0.5">
          <NavLink
            to="/settings"
            end
            title={!expanded ? 'Instellingen' : undefined}
            className={({ isActive }) =>
              `nav-item w-full text-left border-0 font-inherit ${!expanded ? 'justify-center px-2' : ''} ${settingsActive || isActive ? 'active' : ''}`
            }
          >
            <Settings size={18} className="flex-shrink-0" />
            {expanded && (
              <span className="whitespace-nowrap text-[13px]">Instellingen</span>
            )}
          </NavLink>
          <div
            className={`nav-item group relative ${!expanded ? 'justify-center px-2' : ''}`}
            title={!expanded ? displayName : undefined}
          >
            <div className="w-[18px] h-[18px] rounded-full bg-accent flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
              {initials || 'U'}
            </div>
            {expanded && (
              <>
                <span className="whitespace-nowrap text-[13px] truncate pr-7">{displayName}</span>
                <button
                  type="button"
                  onClick={logout}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover/70 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Uitloggen"
                  title="Uitloggen"
                >
                  <LogOut size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
