import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { NavBadgeProvider } from '../../context/NavBadgeContext'
import { InboxCommunicationProvider } from '../../context/InboxCommunicationContext'
import { ChatSessionsProvider } from '../../context/ChatSessionsContext'
import ShellSidebar from './ShellSidebar'
import ShellTopbar from './ShellTopbar'
import CommandPalette from './CommandPalette'

const NAV_COLLAPSED_KEY = 'bokito-nav-collapsed'

function loadNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Routes that take over the full content area (no padding container). */
function isFullBleed(pathname: string): boolean {
  return pathname.startsWith('/communication')
}

export default function AppShell() {
  const { pathname } = useLocation()
  const [navCollapsed, setNavCollapsed] = useState(loadNavCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const toggleCollapsed = useCallback(() => {
    setNavCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // ignore storage failures
      }
      return next
    })
  }, [])

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Global Cmd/Ctrl+K opens the command palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const fullBleed = isFullBleed(pathname)

  return (
    <NavBadgeProvider>
      <InboxCommunicationProvider>
        <ChatSessionsProvider>
          <div className="flex h-screen overflow-hidden bg-bg">
            {/* Desktop sidebar */}
            <aside
              className={`hidden shrink-0 border-r border-border/40 transition-[width] duration-150 lg:block ${
                navCollapsed ? 'w-[64px]' : 'w-[248px]'
              }`}
            >
              <ShellSidebar collapsed={navCollapsed} onToggleCollapsed={toggleCollapsed} />
            </aside>

            {/* Mobile drawer */}
            {drawerOpen ? (
              <div className="fixed inset-0 z-50 lg:hidden">
                <button
                  type="button"
                  aria-label="Close navigation"
                  className="absolute inset-0 bg-black/50"
                  onClick={() => setDrawerOpen(false)}
                />
                <div className="absolute inset-y-0 left-0 w-[268px] border-r border-border/50 shadow-2xl">
                  <ShellSidebar
                    collapsed={false}
                    onToggleCollapsed={() => setDrawerOpen(false)}
                    onNavigate={() => setDrawerOpen(false)}
                  />
                </div>
              </div>
            ) : null}

            {/* Main column */}
            <div className="flex min-w-0 flex-1 flex-col">
              <ShellTopbar
                onOpenNavDrawer={() => setDrawerOpen(true)}
                onOpenPalette={() => setPaletteOpen(true)}
              />
              <main className="min-h-0 flex-1">
                {fullBleed ? (
                  <div className="h-full min-h-0">
                    <Outlet />
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto overflow-x-hidden px-6 pb-8 pt-5">
                    <div className="mx-auto w-full max-w-[1240px]">
                      <Outlet />
                    </div>
                  </div>
                )}
              </main>
            </div>
          </div>

          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        </ChatSessionsProvider>
      </InboxCommunicationProvider>
    </NavBadgeProvider>
  )
}
