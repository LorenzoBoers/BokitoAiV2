import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { livechatWidgetHttpOrigin } from '../../lib/api.config'
import { ensureChatWidgetScript } from '../../lib/chat-widget-loader'
import {
  consumeAssistantThreadRequest,
  openAssistantThread,
  registerAssistantWidget,
} from '../../lib/personal-assistant-widget'
import { tabFromPath, titleForTab } from '../../lib/navigation'

/** Route plus page title, sent with every turn so Bokito can see the screen. */
function describePage(pathname: string, search: string): string {
  if (pathname === '/workspaces' || pathname.startsWith('/workspaces/')) {
    return `Workspaces hub - manage and open workspaces - ${pathname}${search}`
  }
  if (pathname === '/account' || pathname.startsWith('/account/')) {
    return `Account settings - profile and preferences - ${pathname}${search}`
  }
  const tab = tabFromPath(pathname)
  const title = tab ? titleForTab(tab) : 'Bokito'
  return `${title} - ${pathname}${search}`
}

/**
 * The launcher sits bottom-right — exactly where an open conversation puts
 * its send controls. Hide it while a thread or the new-conversation composer
 * is on screen so it never covers a Send button; it returns on every other
 * page (lists, Overview, settings, ...). Topbar Help force-opens the panel
 * even while the launcher is hidden.
 */
function launcherHiddenFor(pathname: string): boolean {
  if (!pathname.startsWith('/communication')) return false
  return pathname.includes('/t/') || pathname.startsWith('/communication/new')
}

function currentTheme(): string {
  if (typeof document === 'undefined') return 'light'
  const fromAttr = document.documentElement.dataset.theme
  if (fromAttr === 'dark' || fromAttr === 'light') return fromAttr
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * Every user's personal Bokito helper, mounted as the real `bokito-chat`
 * element — the same bundle a tenant embeds on their own website. The
 * `in_app` surface makes the backend answer as the platform-owned Bokito
 * agent, serve Bokito's product help in the help tab, and keep the animated
 * Bokito mark instead of tenant messenger branding. The workspace accent
 * colour tints the launcher and chrome so the helper feels part of the app.
 */
export default function PersonalAssistantWidget() {
  const { token } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const { i18n } = useTranslation()
  const { pathname, search } = useLocation()
  const widgetRef = useRef<HTMLElement | null>(null)
  /** True while the panel was force-opened (e.g. topbar Help on Communication). */
  const forceOpenRef = useRef(false)

  const tenantSlug = currentWorkspace?.slug ?? ''
  const workspaceId = currentWorkspace?.id != null ? String(currentWorkspace.id) : ''
  const brandColor = currentWorkspace?.brand_color?.trim() || ''
  const locale = (i18n.language || 'en').slice(0, 2)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let el: HTMLElement | null = null
    const onPanel = (event: Event) => {
      const open = Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open)
      forceOpenRef.current = open
      if (!el) return
      if (open) {
        el.style.display = ''
        return
      }
      if (launcherHiddenFor(window.location.pathname)) el.style.display = 'none'
    }
    void ensureChatWidgetScript()
      .then(() => {
        if (cancelled) return
        el = document.createElement('bokito-chat')
        el.dataset.surface = 'in_app'
        el.dataset.apiUrl = livechatWidgetHttpOrigin()
        // The dashboard access token identifies the person and their
        // workspace; auth is required because the helper is never anonymous.
        el.dataset.authToken = token
        el.dataset.authMode = 'required'
        if (tenantSlug) el.dataset.tenant = tenantSlug
        el.dataset.locale = locale
        el.dataset.pageContext = describePage(
          window.location.pathname,
          window.location.search,
        )
        // Keep the Bokito mark; tint chrome with the workspace accent so the
        // FAB matches the rest of the dashboard instead of default green.
        if (brandColor) {
          el.dataset.previewOverrides = JSON.stringify({ main_color: brandColor })
        }
        el.setAttribute('data-theme', currentTheme())
        if (launcherHiddenFor(window.location.pathname)) el.style.display = 'none'
        el.addEventListener('bokito:panel', onPanel)
        document.body.appendChild(el)
        widgetRef.current = el
        registerAssistantWidget(el)
        // A thread opened from another workspace survives the reload that a
        // workspace switch causes; pick it up once we are in that workspace.
        const pending = workspaceId ? consumeAssistantThreadRequest(workspaceId) : null
        if (pending) openAssistantThread(pending)
      })
      .catch(() => {
        // Bundle missing (widget not built in this checkout): no launcher.
      })
    return () => {
      cancelled = true
      forceOpenRef.current = false
      widgetRef.current = null
      registerAssistantWidget(null)
      el?.removeEventListener('bokito:panel', onPanel)
      el?.remove()
    }
    // Remounting on a workspace switch is intentional: the helper answers
    // inside one workspace at a time, with that workspace's accent and agent.
  }, [token, tenantSlug, workspaceId, brandColor])

  useEffect(() => {
    const el = widgetRef.current
    if (el) el.dataset.locale = locale
  }, [locale])

  useEffect(() => {
    const el = widgetRef.current
    if (!el) return
    el.dataset.pageContext = describePage(pathname, search)
    if (forceOpenRef.current) return
    el.style.display = launcherHiddenFor(pathname) ? 'none' : ''
  }, [pathname, search])

  // Follow the dashboard's light/dark switch.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      widgetRef.current?.setAttribute('data-theme', currentTheme())
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })
    return () => observer.disconnect()
  }, [])

  return null
}
