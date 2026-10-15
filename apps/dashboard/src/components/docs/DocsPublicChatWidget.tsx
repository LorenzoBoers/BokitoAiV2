/**
 * Anonymous Bokito website-chat launcher on public `/docs` and `/docs/api`.
 *
 * Same bundle as a customer embed; routed to the Bokito tenant Website chat
 * channel so visitors outside the logged-in platform can ask questions.
 */
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { livechatWidgetHttpOrigin } from '../../lib/api.config'
import { ensureChatWidgetScript } from '../../lib/chat-widget-loader'
import { docsPublicChatConfig } from '../../lib/docs-public-chat'

function pageTheme(forcedDark: boolean): string {
  if (forcedDark) return 'dark'
  if (typeof document === 'undefined') return 'light'
  const fromAttr = document.documentElement.dataset.theme
  if (fromAttr === 'dark' || fromAttr === 'light') return fromAttr
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function pageContext(pathname: string, search: string): string {
  return `Bokito Docs - ${pathname}${search}`
}

type Props = {
  /** API reference keeps a black canvas regardless of the OS theme. */
  forcedDark?: boolean
}

export default function DocsPublicChatWidget({ forcedDark = false }: Props) {
  const { pathname, search } = useLocation()
  const widgetRef = useRef<HTMLElement | null>(null)
  const config = docsPublicChatConfig()

  useEffect(() => {
    if (!config.channelId || !config.tenant) return
    let cancelled = false
    let el: HTMLElement | null = null
    void ensureChatWidgetScript()
      .then(() => {
        if (cancelled) return
        el = document.createElement('bokito-chat')
        el.dataset.surface = 'site'
        el.dataset.authMode = 'anonymous'
        el.dataset.apiUrl = livechatWidgetHttpOrigin()
        el.dataset.tenant = config.tenant
        el.dataset.channelId = config.channelId
        el.dataset.agentSlug = config.agentSlug
        el.dataset.pageContext = pageContext(
          window.location.pathname,
          window.location.search,
        )
        el.setAttribute('data-theme', pageTheme(forcedDark))
        document.body.appendChild(el)
        widgetRef.current = el
      })
      .catch(() => {
        // Bundle missing in this checkout: docs stay usable without a launcher.
      })
    return () => {
      cancelled = true
      widgetRef.current = null
      el?.remove()
    }
  }, [config.tenant, config.channelId, config.agentSlug, forcedDark])

  useEffect(() => {
    const el = widgetRef.current
    if (el) el.dataset.pageContext = pageContext(pathname, search)
  }, [pathname, search])

  useEffect(() => {
    widgetRef.current?.setAttribute('data-theme', pageTheme(forcedDark))
    if (forcedDark || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      widgetRef.current?.setAttribute('data-theme', pageTheme(false))
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })
    return () => observer.disconnect()
  }, [forcedDark])

  return null
}
