import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NavBadgeProvider, useNavBadges } from '../../context/NavBadgeContext'
import { InboxCommunicationProvider } from '../../context/InboxCommunicationContext'
import { ChatSessionsProvider } from '../../context/ChatSessionsContext'
import ShellSidebar from './ShellSidebar'
import ShellTopbar from './ShellTopbar'
import CommandPalette from './CommandPalette'
import { settingsLinkForPath } from './SettingsLayout'
import ImpersonationBanner from '../layout/ImpersonationBanner'
import MockAiBanner from './MockAiBanner'
import PushSoftPrompt from './PushSoftPrompt'
import VerifyEmailBanner from './VerifyEmailBanner'
import { tabFromPath, titleForTab } from '../../lib/navigation'
import { recordRecentPage, recentLocationKey } from '../../lib/recent-pages'
import TwoFactorBanner from './TwoFactorBanner'
import PersonalAssistantWidget from './PersonalAssistantWidget'
import { TourProvider } from '../tour/TourContext'
import { TicketStageGateProvider } from '../inbox/TicketStageGate'
import { isTypingTarget } from '../../hooks/useInboxListShortcuts'
import { useShellLiveBus } from '../../hooks/useShellLiveBus'
import { setNotificationSoundEnabled, unlockNotificationAudio } from '../../lib/notification-sound'
import { useAuth } from '../../context/AuthContext'
import { policyRoutes } from '../../api/routes/policy.routes'
import { APP_API_BASE } from '../../lib/api.config'
import { normalizeNotificationPrefs } from '../../lib/notification-prefs'
import { cn } from '../../lib/utils'

const NAV_COLLAPSED_KEY = 'bokito-nav-collapsed'

function WorkspaceDocumentTitle() {
  const { t } = useTranslation('nav')
  const { pathname } = useLocation()
  const { counts } = useNavBadges()

  useEffect(() => {
    const tab = tabFromPath(pathname)
    const settingsLink = settingsLinkForPath(pathname)
    // Contacts nests under Communication in the rail, but the document title
    // should say Contacts so the browser tab matches the page (F-79).
    const page = pathname.startsWith('/contacts')
      ? t('tabs.contacts.title')
      : settingsLink
        ? `${t('tabs.settings.title')} / ${t(settingsLink.labelKey)}`
        : tab
          ? t(`tabs.${tab}.title`, { defaultValue: titleForTab(tab) })
          : 'Bokito'
    document.title = counts.inboxUnread > 0 ? `(${counts.inboxUnread}) ${page}` : page
  }, [pathname, counts.inboxUnread, t])

  return null
}

function loadNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Routes that take over the full content area (no padding container). */
function isFullBleed(pathname: string): boolean {
  // Module workspaces are document pages (PageContent + sections); they need
  // the shell scroller, not a clipped full-bleed pane.
  if (pathname.startsWith('/ai/modules')) return false
  return (
    pathname.startsWith('/communication') ||
    pathname.startsWith('/knowledge') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/ai/') ||
    pathname.startsWith('/agenda')
  )
}

/** Calendar-style pages use the whole width of the content pane. */
function isWide(pathname: string): boolean {
  return pathname.startsWith('/agenda')
}

/** Coarse key so thread/doc leaf switches do not replay the shell enter. */
function contentEnterKey(pathname: string): string {
  if (pathname.startsWith('/communication')) return 'communication'
  if (pathname.startsWith('/knowledge')) return pathname.split('/').slice(0, 3).join('/') || 'knowledge'
  if (pathname.startsWith('/settings')) return pathname.split('/').slice(0, 3).join('/') || 'settings'
  if (pathname.startsWith('/ai/')) return pathname.split('/').slice(0, 3).join('/') || 'ai'
  if (pathname.startsWith('/agenda')) return 'agenda'
  // Document pages already animate via PageContent — avoid a second remount.
  return 'document'
}

export default function AppShell() {
  const { token } = useAuth()
  useShellLiveBus()
  useEffect(() => {
    unlockNotificationAudio()
  }, [])
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetch(`${APP_API_BASE}${policyRoutes.notificationPreferences()}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setNotificationSoundEnabled(normalizeNotificationPrefs(data).sound)
      })
      .catch(() => {
        // The notifications page still loads the preference later.
      })
    return () => {
      cancelled = true
    }
  }, [token])
  const { t } = useTranslation('nav')
  const { pathname, search } = useLocation()
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

  useEffect(() => {
    const tab = tabFromPath(pathname)
    const settingsLink = settingsLinkForPath(pathname)
    const title = settingsLink
      ? `${t('tabs.settings.title')} / ${t(settingsLink.labelKey)}`
      : tab
        ? t(`tabs.${tab}.title`, { defaultValue: titleForTab(tab) })
        : 'Bokito'
    recordRecentPage(recentLocationKey(pathname, search), title)
  }, [pathname, search, t])

  // Global Cmd/Ctrl+K opens the command palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
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
      <WorkspaceDocumentTitle />
      <InboxCommunicationProvider>
        <ChatSessionsProvider>
          <TourProvider>
          <TicketStageGateProvider>
          <div className="flex h-screen overflow-hidden bg-bg">
            {/* Desktop sidebar */}
            <aside
              className={`hidden shrink-0 border-r border-border/60 transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] lg:block ${
                navCollapsed ? 'w-[52px]' : 'w-[232px]'
              }`}
            >
              <ShellSidebar collapsed={navCollapsed} onToggleCollapsed={toggleCollapsed} />
            </aside>

            {/* Mobile drawer */}
            {drawerOpen ? (
              <div className="fixed inset-0 z-50 lg:hidden">
                <button
                  type="button"
                  aria-label={t('topbar.closeNavigation')}
                  className="absolute inset-0 bg-black/50 animate-fade-in"
                  onClick={() => setDrawerOpen(false)}
                />
                <div className="absolute inset-y-0 left-0 w-[260px] border-r border-border/60 bg-bg shadow-overlay animate-slide-in-left">
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
              <ImpersonationBanner />
              <ShellTopbar
                onOpenNavDrawer={() => setDrawerOpen(true)}
                onOpenPalette={() => setPaletteOpen(true)}
              />
              <VerifyEmailBanner />
              <TwoFactorBanner />
              <MockAiBanner />
              <PushSoftPrompt />
              <main className="min-h-0 flex-1">
                {fullBleed ? (
                  <div
                    key={contentEnterKey(pathname)}
                    className="h-full min-h-0 animate-content-enter overflow-hidden"
                  >
                    <Outlet />
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto overflow-x-hidden px-6 pb-8 pt-4">
                    <div className={cn('mx-auto w-full', isWide(pathname) ? 'max-w-[1800px]' : 'max-w-[1240px]')}>
                      <Outlet />
                    </div>
                  </div>
                )}
              </main>
            </div>
          </div>

          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          {/* Mounted on every page, including Messages: the Bokito rail
            section there hands its threads to this one widget instead of
            rendering a second chat surface. */}
          <PersonalAssistantWidget />
          </TicketStageGateProvider>
          </TourProvider>
        </ChatSessionsProvider>
      </InboxCommunicationProvider>
    </NavBadgeProvider>
  )
}
