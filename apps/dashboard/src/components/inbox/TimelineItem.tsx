import { Check, Copy, Loader2, Mail, MessageSquareWarning, Pencil, Phone, ThumbsDown, ThumbsUp, Trash2, User, X as XIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { isMockAgentBody, translateMockAgentBody } from '../../lib/activity-labels'
import { cn } from '../../lib/utils'
import { cancelScheduledMessage, submitMessageFeedback } from '../../lib/signals-api'
import { useCorrectionChat } from '../../lib/correction-chat'
import { ContactAvatar } from '../ui/ContactAvatar'
import { UserAvatar } from '../ui/UserAvatar'
import { Tip } from '../ui/Tip'
import { useConfirm } from '../ui/confirm-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { formatAppTime } from '../../lib/app-locale'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import type { InboxEvent, InboxMessage, InboxMember, MessageAttachment, ThreadId } from '../../lib/inbox-api'
import { asMessageAttachments, getMessage } from '../../lib/inbox-api'
import { mentionMarkupToHtmlChips } from '../../lib/mentions'
import { AI_PILL_CLASS, AiMark } from '../ai/AiMark'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { normalizeMode, type AiHandlingMode } from '../../lib/ai-handling'
import { AiAvatar } from '../ui/AiAvatar'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import {
  BubbleAction,
  BubbleHeader,
  ChatMessageBubble,
  type BubbleStack,
  type BubbleVariant,
} from './ChatBubble'
import MessageAttachments from './MessageAttachments'
import ChatText from './ChatText'
import ActivityTrail from './ActivityTrail'
import { isCustomerChannel } from '../../lib/chatMessages'
import { threadPatchHasMeaning } from '../../lib/thread-events'
import { WorkbenchJobCard } from './WorkbenchJobCard'
import { inboxPath } from '../../lib/messages-paths'
import { stageLabel, type TicketStageKind } from '../../lib/tickets-api'
import { SplitConversationAction } from './SplitConversationAction'

type MessageLayout = 'chat' | 'email'

/** Edit/delete callbacks for internal notes; omit to render notes read-only. */
export type NoteActions = {
  onEdit: (messageId: string, bodyText: string) => Promise<void>
  onDelete: (messageId: string) => Promise<void>
}

type MessageItemProps = {
  message: InboxMessage
  /** Open thread id — used to lazy-fetch HTML / activity detail on expand. */
  threadId?: ThreadId | null
  /** Thread channel; delivery labels only show on customer channels. */
  channel?: string | null
  layout?: MessageLayout
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  membersById?: Record<number, InboxMember>
  noteActions?: NoteActions
  /** Name of the agent bound to this thread, shown on AI messages. */
  agentName?: string | null
  agentId?: string | null
  agentAvatarKind?: string | null
  agentAvatarIcon?: string | null
  agentAvatarColor?: string | null
  agentAvatarImageUrl?: string | null
  /** WhatsApp-style group position among consecutive same-author bubbles. */
  stack?: BubbleStack
}

type EventItemProps = {
  event: InboxEvent
  memberName?: string
  memberNameFor?: (userId: number | null | undefined) => string | undefined
}

export function formatHourMinute(iso: string | null, language?: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return formatAppTime(date, language)
}

// Hover popover with contact details (name, email, phone) shown next to the
// avatar. Renders only the rows that have data. Style mirrors the sidebar
// tooltip and user-menu popup (bg-bg-elevated, rounded border, soft shadow).
function ContactHoverInfo({
  name,
  email,
  phone,
}: {
  name?: string
  email?: string
  phone?: string
}) {
  const hasName = !!name && name !== email
  const hasEmail = !!email
  const hasPhone = !!phone
  if (!hasName && !hasEmail && !hasPhone) return null

  return (
    <div className="flex flex-col gap-1.5 min-w-[180px]">
      {hasName ? (
        <div className="flex items-center gap-2 text-text-heading">
          <User size={12} className="text-text-muted shrink-0" />
          <span className="text-xs font-semibold truncate-fade">{name}</span>
        </div>
      ) : null}
      {hasEmail ? (
        <div className="flex items-center gap-2">
          <Mail size={12} className="text-text-muted shrink-0" />
          <a
            href={`mailto:${email}`}
            className="text-xs text-text-secondary truncate-fade hover:text-accent"
            onClick={(e) => e.stopPropagation()}
          >
            {email}
          </a>
        </div>
      ) : null}
      {hasPhone ? (
        <div className="flex items-center gap-2">
          <Phone size={12} className="text-text-muted shrink-0" />
          <a
            href={`tel:${phone}`}
            className="text-xs text-text-secondary truncate-fade hover:text-accent"
            onClick={(e) => e.stopPropagation()}
          >
            {phone}
          </a>
        </div>
      ) : null}
    </div>
  )
}

// External counterparty avatar with a hover tooltip (name / email / phone).
function ContactAvatarWithHover({
  email,
  name,
  phone,
  size = 32,
}: {
  email: string
  name: string
  phone?: string
  size?: number
}) {
  const avatarNode = (
    <ContactAvatar name={name} email={email} size={size} className="cursor-default" />
  )

  const hasInfo = !!(name && name !== email) || !!email || !!phone
  if (!hasInfo) return avatarNode

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{avatarNode}</TooltipTrigger>
      <TooltipContent side="right" align="start" className="p-2.5">
        <ContactHoverInfo name={name} email={email} phone={phone} />
      </TooltipContent>
    </Tooltip>
  )
}

function isSimpleMessageHtml(html: string): boolean {
  const trimmed = html.trim()
  if (!trimmed) return true
  if (/<(?:table|style|link|script|iframe|object|embed|form|meta|font)\b/i.test(trimmed)) return false
  if (/\bbackground(?:-color)?\s*:/i.test(trimmed)) return false
  // Inline text colors are designed for a light background; route through the
  // iframe so the dark-mode transform keeps them readable.
  if (/(?:^|[^-\w])color\s*[:=]/i.test(trimmed)) return false
  return true
}

/** True when a plain-text body is actually HTML source (mislabelled part). */
function looksLikeEmailHtml(value: string | null | undefined): boolean {
  const raw = (value || '').trim()
  if (!raw || raw.length < 32) return false
  if (/^<!DOCTYPE\s+html/i.test(raw) || /^<html[\s>]/i.test(raw)) return true
  if (/<!--\s*\[if\s+mso\]/i.test(raw)) return true
  if (/<(?:table|style|head|body|div|p|img|a)\b/i.test(raw) && /<\/(?:table|style|head|body|div|p|a)>/i.test(raw)) {
    return true
  }
  return false
}

/** Off-screen iframe placeholder: never dump raw HTML/MSO comments into the bubble. */
function htmlToPlainPreview(html: string, fallbackText?: string): string {
  const fallback = (fallbackText || '').replace(/\s+/g, ' ').trim()
  if (fallback && !looksLikeEmailHtml(fallback)) return fallback.slice(0, 280)
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[if[\s\S]*?<!\[endif\]-->/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCharCode(code) : ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 280)
}

function normalizeCidKey(value: string): string {
  return value.trim().replace(/^<|>$/g, '').trim().toLowerCase()
}

/** Rewrite leftover cid: image refs using stored inline attachments. */
function rewriteCidInHtml(
  html: string,
  attachments: Array<{ url: string; contentId?: string | null; inline?: boolean }>,
): string {
  if (!html || !attachments.length) return html
  const lookup = new Map<string, string>()
  for (const att of attachments) {
    const cid = att.contentId ? normalizeCidKey(att.contentId) : ''
    if (cid && att.url) lookup.set(cid, att.url)
  }
  if (lookup.size === 0) return html
  let out = html.replace(
    /(?:src|background)\s*=\s*(["'])cid:(.*?)\1/gi,
    (full, quote: string, rawId: string) => {
      const url = lookup.get(normalizeCidKey(rawId))
      if (!url) return full
      return `src=${quote}${url}${quote}`
    },
  )
  out = out.replace(/(?:src|background)\s*=\s*cid:([^\s>]+)/gi, (full, rawId: string) => {
    const url = lookup.get(normalizeCidKey(rawId))
    if (!url) return full
    return `src="${url}"`
  })
  return out
}

function SimpleMessageHtml({ html }: { html: string }) {
  return (
    <div
      className="break-words [&_img]:mt-4 [&_img]:block [&_img]:max-w-[260px] [&_img]:h-auto"
      dangerouslySetInnerHTML={{ __html: mentionMarkupToHtmlChips(html) }}
    />
  )
}

// ── dark-mode email transform helpers ─────────────────────────────

function parseCssRgb(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = value.match(/rgba?\(([^)]+)\)/i)
  if (!match) return null
  const parts = match[1].split(',').map((p) => parseFloat(p.trim()))
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
}

function relativeLuminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Effective background luminance of an email document. Walks the body and its
 * main containers for the first explicit (non-transparent) background —
 * computed styles also reflect legacy `bgcolor` attributes. Emails without an
 * explicit background are designed for white, so they count as light.
 */
function emailBackgroundLuminance(doc: Document): number {
  const win = doc.defaultView
  const body = doc.body
  if (!win || !body) return 1
  const candidates: Element[] = [body, ...Array.from(body.querySelectorAll('table, td, center, div, section'))].slice(0, 60)
  for (const el of candidates) {
    const rgb = parseCssRgb(win.getComputedStyle(el).backgroundColor || '')
    if (!rgb || rgb.a === 0) continue
    return relativeLuminance(rgb.r, rgb.g, rgb.b)
  }
  return 1
}

/** App dark-mode card surface (`--color-bg-surface`), read from the theme. */
function appSurfaceRgb(): { r: number; g: number; b: number } {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-surface').trim()
  const parts = raw.split(/[\s,]+/).map((p) => parseFloat(p))
  if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
    return { r: parts[0], g: parts[1], b: parts[2] }
  }
  return { r: 29, g: 32, b: 43 }
}

type Rgb = { r: number; g: number; b: number }

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h / 6, s, l }
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  }
}

/** Flip a color's lightness while keeping hue and saturation. */
function flipLightness(rgb: Rgb, minL: number, maxL: number): Rgb {
  const { h, s, l } = rgbToHsl(rgb)
  const flipped = Math.min(maxL, Math.max(minL, 1 - l))
  return hslToRgb(h, s, flipped)
}

const cssRgb = ({ r, g, b }: Rgb) => `rgb(${r} ${g} ${b})`

const EMAIL_QUOTE_SELECTORS = [
  '.gmail_quote',
  '.gmail_quote_container',
  '.gmail_extra',
  '#divRplyFwdMsg',
  '#mail-editor-reference-message-container',
  'blockquote[type="cite"]',
  'div[id="appendonsend"]',
].join(',')

const EMAIL_HEIGHT_CAP_PX = 480

function findEmailQuoteRoots(doc: Document): HTMLElement[] {
  const roots: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  const add = (el: HTMLElement | null) => {
    if (!el || seen.has(el)) return
    // Prefer outermost quote block when nested.
    for (const existing of roots) {
      if (existing.contains(el)) return
      if (el.contains(existing)) {
        seen.delete(existing)
        roots.splice(roots.indexOf(existing), 1)
      }
    }
    seen.add(el)
    roots.push(el)
  }

  doc.querySelectorAll(EMAIL_QUOTE_SELECTORS).forEach((node) => {
    if (node instanceof HTMLElement) add(node)
  })

  // Outlook / Apple Mail plain wrappers: a horizontal rule or "On … wrote" /
  // "Op … schreef" line that begins the quoted trail.
  const walk = doc.body ? Array.from(doc.body.querySelectorAll('div, p, span, hr')) : []
  for (const node of walk) {
    if (!(node instanceof HTMLElement)) continue
    if (node.closest(EMAIL_QUOTE_SELECTORS)) continue
    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
    if (
      /^On .{10,120} wrote:$/i.test(text) ||
      /^Op .{10,120} schreef .+:$/i.test(text) ||
      /^-----Original Message-----$/i.test(text)
    ) {
      // Collapse from this marker through the rest of its parent siblings.
      const parent = node.parentElement
      if (parent && parent !== doc.body) {
        add(parent)
      } else {
        add(node)
      }
    }
  }
  return roots
}

// Renders email HTML inside a sandboxed iframe so the email's <style> tags,
// link colors and other global rules do not bleed into the host app.
//
// Dark mode: email HTML is designed for light backgrounds and carries its own
// (dark) text colors. Like Gmail, we rewrite colors in the DOM (luminance
// aware, hue preserving) instead of using CSS invert filters — filters kill
// subpixel text antialiasing and make text fuzzy. Emails that are already
// dark-designed render untouched on the dark surface.
function EmailHtmlFrame({ html, isDark }: { html: string; isDark: boolean }) {
  const { t } = useTranslation('communication')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const quoteRootsRef = useRef<HTMLElement[]>([])
  const [naturalHeight, setNaturalHeight] = useState(80)
  const [quotesCollapsed, setQuotesCollapsed] = useState(true)
  const [hasQuotes, setHasQuotes] = useState(false)
  const [expandedFull, setExpandedFull] = useState(false)

  const measure = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return
    const next = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
      40,
    )
    setNaturalHeight(next)
  }, [])

  // Light emails get their colors rewritten in place (no CSS filter — filters
  // disable subpixel text antialiasing and make text look thin and fuzzy):
  //  - near-white backgrounds become exactly the app card surface (seamless)
  //  - other light backgrounds get their lightness flipped, hue preserved
  //  - dark text becomes light text; colored/branded elements keep their hue
  //  - images and background-image sections are left untouched
  const applyDarkTheme = useCallback((doc: Document) => {
    if (doc.getElementById('bokito-dark-email-theme')) return
    const style = doc.createElement('style')
    style.id = 'bokito-dark-email-theme'
    if (emailBackgroundLuminance(doc) > 0.45) {
      const surfaceColor = cssRgb(appSurfaceRgb())
      const win = doc.defaultView
      if (win && doc.body) {
        const all = [doc.body, ...Array.from(doc.body.querySelectorAll('*'))].slice(0, 4000)
        for (const el of all) {
          if (!(el instanceof win.HTMLElement)) continue
          const computed = win.getComputedStyle(el)
          // Sections designed on top of an actual image keep text and colors.
          if ((computed.backgroundImage || '').includes('url(')) continue

          const bg = parseCssRgb(computed.backgroundColor || '')
          if (bg && bg.a > 0) {
            const lum = relativeLuminance(bg.r, bg.g, bg.b)
            if (lum > 0.88) {
              el.dataset.bokitoPrevBg = el.style.getPropertyValue('background-color')
              el.style.setProperty('background-color', surfaceColor, 'important')
            } else if (lum > 0.45) {
              el.dataset.bokitoPrevBg = el.style.getPropertyValue('background-color')
              el.style.setProperty('background-color', cssRgb(flipLightness(bg, 0.08, 0.3)), 'important')
            }
            // Darker backgrounds (buttons, banners) keep their designed color.
          }

          const fg = parseCssRgb(computed.color || '')
          if (fg && rgbToHsl(fg).l < 0.55) {
            el.dataset.bokitoPrevColor = el.style.getPropertyValue('color')
            el.style.setProperty('color', cssRgb(flipLightness(fg, 0.66, 0.94)), 'important')
          }

          // Light borders would show up as bright lines on the dark surface.
          const sides = ['top', 'right', 'bottom', 'left'] as const
          for (const side of sides) {
            const width = computed.getPropertyValue(`border-${side}-width`)
            if (!width || width === '0px') continue
            const bc = parseCssRgb(computed.getPropertyValue(`border-${side}-color`) || '')
            if (!bc || bc.a === 0 || rgbToHsl(bc).l <= 0.55) continue
            if (el.dataset.bokitoPrevBorder === undefined) {
              el.dataset.bokitoPrevBorder = el.style.getPropertyValue('border-color')
            }
            el.style.setProperty(`border-${side}-color`, cssRgb(flipLightness(bc, 0.16, 0.32)), 'important')
          }
        }
      }
      style.textContent = `
html, body { background: transparent !important; }
`
    } else {
      // Dark-designed email: keep its own palette, blend into the card and
      // make default-colored text light.
      style.textContent = `
html, body { background: transparent !important; color: #e2e8f0; }
a { color: #60a5fa; }
`
    }
    doc.head.appendChild(style)
  }, [])

  const applyQuoteCollapse = useCallback(
    (collapsed: boolean) => {
      for (const el of quoteRootsRef.current) {
        el.style.display = collapsed ? 'none' : ''
      }
      measure()
    },
    [measure],
  )

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (doc && isDark) applyDarkTheme(doc)
    if (!doc) {
      measure()
      return
    }
    const roots = findEmailQuoteRoots(doc)
    quoteRootsRef.current = roots
    setHasQuotes(roots.length > 0)
    setQuotesCollapsed(true)
    setExpandedFull(false)
    if (roots.length > 0) {
      for (const el of roots) el.style.display = 'none'
    }
    measure()
    // Remote CDNs (Google, ESP trackers) often block hotlinks when the
    // referrer is the app origin; no-referrer matches Gmail's image proxy
    // behaviour and unblocks most marketing-mail images.
    doc.querySelectorAll('img').forEach((img) => {
      img.setAttribute('referrerpolicy', 'no-referrer')
      if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy')
      if (!img.complete) {
        img.addEventListener('load', measure, { once: true })
        img.addEventListener('error', measure, { once: true })
      }
    })
    doc.querySelectorAll('a').forEach((a) => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })
  }, [applyDarkTheme, isDark, measure])

  useEffect(() => {
    const id = window.setTimeout(measure, 250)
    return () => window.clearTimeout(id)
  }, [measure, html])

  useEffect(() => {
    setHasQuotes(false)
    setQuotesCollapsed(true)
    setExpandedFull(false)
    quoteRootsRef.current = []
  }, [html])

  // Theme switches without a reload: (re)apply on an already-loaded document.
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc?.body) return
    if (isDark) {
      applyDarkTheme(doc)
    } else {
      doc.getElementById('bokito-dark-email-theme')?.remove()
      const restore = (el: HTMLElement, prop: string, prev: string | undefined) => {
        if (prev) el.style.setProperty(prop, prev)
        else el.style.removeProperty(prop)
      }
      doc.querySelectorAll<HTMLElement>('[data-bokito-prev-bg]').forEach((el) => {
        restore(el, 'background-color', el.dataset.bokitoPrevBg)
        delete el.dataset.bokitoPrevBg
      })
      doc.querySelectorAll<HTMLElement>('[data-bokito-prev-color]').forEach((el) => {
        restore(el, 'color', el.dataset.bokitoPrevColor)
        delete el.dataset.bokitoPrevColor
      })
      doc.querySelectorAll<HTMLElement>('[data-bokito-prev-border]').forEach((el) => {
        for (const side of ['top', 'right', 'bottom', 'left']) {
          el.style.removeProperty(`border-${side}-color`)
        }
        if (el.dataset.bokitoPrevBorder) el.style.setProperty('border-color', el.dataset.bokitoPrevBorder)
        delete el.dataset.bokitoPrevBorder
      })
    }
  }, [applyDarkTheme, isDark])

  // Base document renders the email as designed (light defaults); the
  // dark-mode style sheet injected on load decides invert vs. blend.
  const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><style>
html { background: transparent; }
html, body { margin: 0; padding: 0; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.5; word-break: break-word; }
body { padding: 2px 0; background: transparent; }
img { max-width: 100%; height: auto; }
table { max-width: 100% !important; }
a { color: #2563eb; }
</style></head><body><div id="bokito-email-root">${html}</div></body></html>`

  const capped = !expandedFull && naturalHeight > EMAIL_HEIGHT_CAP_PX
  const displayHeight = capped ? EMAIL_HEIGHT_CAP_PX : naturalHeight

  return (
    <div className="space-y-1.5">
      <div className={cn('relative overflow-hidden', capped && 'max-h-[480px]')}>
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={wrappedHtml}
          onLoad={handleLoad}
          title={t('timeline.events.emailContent')}
          className="block w-full bg-transparent"
          style={{
            height: `${displayHeight}px`,
            border: 0,
            background: 'transparent',
            colorScheme: 'light',
          }}
        />
        {capped ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bg-surface to-transparent" />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {hasQuotes ? (
          <button
            type="button"
            className="text-xs font-medium text-text-muted hover:text-text-primary"
            onClick={() => {
              const next = !quotesCollapsed
              setQuotesCollapsed(next)
              applyQuoteCollapse(next)
            }}
          >
            {quotesCollapsed ? t('timeline.showQuoted') : t('timeline.hideQuoted')}
          </button>
        ) : null}
        {capped || (expandedFull && naturalHeight > EMAIL_HEIGHT_CAP_PX) ? (
          <button
            type="button"
            className="text-xs font-medium text-text-muted hover:text-text-primary"
            onClick={() => setExpandedFull((v) => !v)}
          >
            {expandedFull ? t('timeline.showLessMessage') : t('timeline.showFullMessage')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Mount the heavy sandboxed iframe only near the viewport. Off-screen emails
 * keep a light text preview so long threads do not hold dozens of iframe
 * documents + decoded images in memory at once.
 */
function LazyEmailHtmlFrame({
  html,
  isDark,
  plainText,
}: {
  html: string
  isDark: boolean
  plainText?: string
}) {
  const { t } = useTranslation('communication')
  const hostRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [wasVisible, setWasVisible] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      setWasVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          setVisible(true)
          setWasVisible(true)
        } else if (entry.intersectionRatio === 0) {
          // Drop the iframe once fully off-screen so memory can reclaim.
          setVisible(false)
        }
      },
      { rootMargin: '200px 0px', threshold: [0, 0.01] },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const plainPreview = useMemo(
    () => htmlToPlainPreview(html, plainText),
    [html, plainText],
  )

  return (
    <div ref={hostRef} className="min-h-[4.5rem]">
      {visible ? (
        <EmailHtmlFrame html={html} isDark={isDark} />
      ) : (
        <div
          className="rounded-md border border-border/40 bg-bg-elevated px-3 py-2 text-sm leading-relaxed text-text-secondary"
          aria-label={t('timeline.events.emailContent')}
        >
          {wasVisible ? (
            <span className="text-text-muted">{t('timeline.showFullMessage')}</span>
          ) : plainPreview ? (
            <span className="line-clamp-4 whitespace-pre-wrap">{plainPreview}</span>
          ) : (
            <span className="text-text-muted">{t('timeline.events.emailContent')}</span>
          )}
        </div>
      )}
    </div>
  )
}

function MessageHtmlBody({
  html,
  plainText,
  attachments,
}: {
  html: string
  plainText?: string
  attachments?: Array<{ url: string; contentId?: string | null; inline?: boolean }>
}) {
  const { isDark } = useTheme()
  const resolvedHtml = useMemo(
    () => rewriteCidInHtml(html, attachments ?? []),
    [html, attachments],
  )
  if (isSimpleMessageHtml(resolvedHtml)) {
    return <SimpleMessageHtml html={resolvedHtml} />
  }
  return <LazyEmailHtmlFrame html={resolvedHtml} isDark={isDark} plainText={plainText} />
}

type MemberNameResolver = (userId: number | null | undefined) => string | undefined

type EventLabelFn = (
  t: TFunction,
  payload: Record<string, unknown>,
  memberName?: string,
  memberNameFor?: MemberNameResolver,
) => string

function ruleTargetSuffix(payload: Record<string, unknown>): string {
  return typeof payload.match_value === 'string' && payload.match_value ? ` (${payload.match_value})` : ''
}

const EVENT_LABELS: Record<string, EventLabelFn> = {
  thread_created: (t) => t('timeline.events.threadCreated'),
  signal_created: (t) => t('timeline.events.conversationStarted'),
  assigned: (t, p, name) =>
    t('timeline.events.assigned', {
      name: name ?? t('timeline.events.userFallback', { id: String(p.assignee_id ?? '') }),
    }),
  unassigned: (t) => t('timeline.events.unassigned'),
  picked_up: (t, p, name) => {
    const who = name ?? t('timeline.events.someone')
    const team =
      p.team_kind === 'people'
        ? t('nav:teamPage.system.people')
        : typeof p.team_name === 'string'
          ? p.team_name
          : ''
    return team
      ? t('timeline.events.pickedUpVia', { name: who, team })
      : t('timeline.events.pickedUp', { name: who })
  },
  status_changed: (t, p) => t('timeline.events.statusChanged', { status: String(p.to_status ?? '') }),
  tag_added: (t, p) =>
    t('timeline.events.labelAdded', {
      tags: Array.isArray(p.tags) ? p.tags.join(', ') : '',
    }),
  tag_removed: (t) => t('timeline.events.labelRemoved'),
  priority_changed: (t, p) => t('timeline.events.priority', { priority: String(p.priority ?? '') }),
  replied: (t) => t('timeline.events.replySent'),
  reply_sent: (t) => t('timeline.events.replySent'),
  note_added: (t) => t('timeline.events.noteAdded'),
  message_added: (t) => t('timeline.events.messageAdded'),
  reopened: (t) => t('timeline.events.reopened'),
  thread_updated: (t, p, _name, memberNameFor) => {
    const status = typeof p.status === 'string' ? p.status : null
    const bulk = typeof p.bulk === 'string' ? p.bulk : null
    if (status === 'closed' || bulk === 'close') return t('timeline.events.threadClosed')
    if (status === 'spam' || bulk === 'spam') return t('timeline.events.markedSpam')
    if (status === 'pending') return t('timeline.events.threadSnoozed')
    if (status === 'open' || bulk === 'reopen') return t('timeline.events.threadReopened')
    if (p.assigned_to === 0) return t('timeline.events.unassigned')
    if (bulk === 'assign' || p.assigned_to != null) {
      // Name the assignee when the member list knows them; the bare label
      // otherwise ("assigned to whom?" is the first thing a reader asks).
      const assignee =
        typeof p.assigned_to === 'number' ? memberNameFor?.(p.assigned_to) : undefined
      return assignee
        ? t('timeline.events.assigned', { name: assignee })
        : t('timeline.events.threadAssigned')
    }
    if (typeof p.priority === 'string' && p.priority) return t('timeline.events.priority', { priority: p.priority })
    if (Array.isArray(p.tags)) {
      return p.tags.length > 0
        ? t('timeline.events.labels', { tags: p.tags.join(', ') })
        : t('timeline.events.labelsCleared')
    }
    return t('timeline.events.threadUpdated')
  },
  snooze_expired: (t) => t('timeline.events.snoozeExpired'),
  widget_seen: (t) => t('timeline.events.widgetSeen'),
  agent_processed: (t) => t('timeline.events.agentReviewed'),
  agent_blocked: (t, p) =>
    t(`timeline.events.agentBlocked.${typeof p.block === 'string' ? p.block : 'other'}`, {
      defaultValue: t('timeline.events.agentBlocked.other'),
    }),
  no_reply_noted: (t) => t('timeline.events.noReplyNoted'),
  agent_invoked: (t) => t('timeline.events.agentInvoked'),
  agent_replied: (t) => t('timeline.events.agentReplied'),
  suggestion_created: (t) => t('timeline.events.suggestionCreated'),
  decision_created: (t) => t('timeline.events.decisionCreated'),
  triaged: (t) => t('timeline.events.triaged'),
  category_set: (t, p) => {
    const category = String(p.category ?? '')
    if (p.proposed) return t('timeline.events.categoryProposed', { category })
    return typeof p.previous === 'string' && p.previous
      ? t('timeline.events.categoryChanged', { category, previous: p.previous })
      : t('timeline.events.categorySet', { category })
  },
  split: (t, p) => {
    const category = typeof p.category === 'string' ? p.category : ''
    if (p.direction === 'in') return t('timeline.events.splitIn')
    return category
      ? t('timeline.events.splitOutCategory', { category })
      : t('timeline.events.splitOut')
  },
  ticket_stage_changed: (t, p) => {
    const kind = p.to_kind as TicketStageKind | undefined
    const name = String(p.to_stage ?? '')
    const stage = kind ? stageLabel({ key: String(p.to_key ?? kind), name, kind }, t) : name
    return t('timeline.events.ticketStageChanged', { stage })
  },
  escalated: (t) => t('timeline.events.escalated'),
  ai_paused: (t) => t('timeline.events.aiPaused'),
  ai_resumed: (t) => t('timeline.events.aiResumed'),
  ai_handling_changed: (t, p, name) => {
    const to = normalizeMode(p.to)
    if (!to) {
      return name
        ? t('timeline.events.handlingClearedBy', { name })
        : t('timeline.events.handlingCleared')
    }
    const reason = typeof p.reason === 'string' ? p.reason : ''
    if (to === 'manual' && reason && reason !== 'operator' && !name) {
      return t('timeline.events.handlingHeld', {
        reason: t(`common:aiHandling.reasons.${reason}`, { defaultValue: reason }),
      })
    }
    const mode = t(`common:aiHandling.modes.${to}.label`)
    return name
      ? t('timeline.events.handlingSetBy', { name, mode })
      : t('timeline.events.handlingSet', { mode })
  },
  ai_handling_downgraded: (t, p) => {
    const reason = typeof p.reason === 'string' ? p.reason : ''
    return t('timeline.events.handlingDowngraded', {
      reason: t(`timeline.events.downgradeReasons.${reason}`, { defaultValue: reason }),
    })
  },
  ai_breaker_tripped: (t) => t('timeline.events.breakerTripped'),
  agent_assigned: (t, p) =>
    typeof p.agent_name === 'string' && p.agent_name
      ? t('timeline.events.agentAssigned', { name: p.agent_name })
      : t('timeline.events.agentAssignedGeneric'),
  decision_approved: (t, _, name) =>
    name ? t('timeline.events.approvedBy', { name }) : t('timeline.events.suggestionApproved'),
  decision_dismissed: (t, _, name) =>
    name ? t('timeline.events.dismissedBy', { name }) : t('timeline.events.suggestionDismissed'),
  decision_edited: (t, _, name) =>
    name ? t('timeline.events.editedBy', { name }) : t('timeline.events.suggestionEdited'),
  rule_applied: (t, p) => {
    const target = ruleTargetSuffix(p)
    if (p.action === 'auto_close') return t('timeline.events.autoClosedByRule', { target })
    if (p.action === 'auto_task') return t('timeline.events.taskCreatedByRule', { target })
    if (p.action === 'mute_ai') return t('timeline.events.aiSkippedByRule', { target })
    if (p.action === 'tag' && Array.isArray(p.tags_added)) {
      return t('timeline.events.taggedByRule', { tags: p.tags_added.join(', '), target })
    }
    return t('timeline.events.handledByRule', { target })
  },
}

// Events that belong to the AI flow get the unified accent treatment so agent
// activity reads as one visual system instead of scattered divider lines.
const AI_EVENT_TYPES = new Set([
  'agent_processed',
  'agent_blocked',
  'no_reply_noted',
  'agent_invoked',
  'agent_replied',
  'suggestion_created',
  'decision_created',
  'triaged',
  'escalated',
  'ai_paused',
  'ai_resumed',
  'rule_applied',
])

function handlingEventMode(eventType: string, payload: Record<string, unknown>): AiHandlingMode | null {
  if (eventType === 'ai_handling_changed') return normalizeMode(payload.to) ?? 'assisted'
  if (eventType === 'ai_handling_downgraded' || eventType === 'ai_breaker_tripped') return 'assisted'
  if (eventType === 'agent_assigned') return 'autonomous'
  return null
}

function eventPresentation(
  eventType: string,
  payload: Record<string, unknown> = {},
): { ai: boolean; icon: ReactNode } {
  const handlingMode = handlingEventMode(eventType, payload)
  if (handlingMode) {
    return {
      ai: handlingMode !== 'manual',
      icon: <AiHandlingIcon mode={handlingMode} size={10} />,
    }
  }
  if (eventType === 'decision_approved') return { ai: true, icon: <Check size={10} /> }
  if (eventType === 'decision_dismissed') return { ai: true, icon: <XIcon size={10} /> }
  if (AI_EVENT_TYPES.has(eventType) || (eventType && eventType.startsWith('decision_'))) {
    return { ai: true, icon: <AiMark size={10} /> }
  }
  return { ai: false, icon: null }
}

function eventLabel(
  event: InboxEvent,
  t: TFunction,
  memberName?: string,
  memberNameFor?: MemberNameResolver,
): string {
  const labelFn = EVENT_LABELS[event.eventType]
  if (labelFn) return labelFn(t, event.payload, memberName, memberNameFor)
  // Prefer a known generic label over English snake_case leftovers (F-77).
  return t('timeline.events.messageAdded')
}

// Compact centered pill shared by SignalEvents and system_event messages.
// AI-flow events share one accent-tinted style; plain system activity stays muted.
function ActivityPill({
  label,
  ai = false,
  icon = null,
  tip,
}: {
  label: string
  ai?: boolean
  icon?: ReactNode
  /** Optional human-readable hover hint — never raw JSON / dumps. */
  tip?: string
}) {
  return (
    <Tip label={tip}>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-2xs leading-4 whitespace-nowrap',
          ai ? 'bg-ai/[0.08] text-ai-ink' : 'bg-bg-elevated/70 text-text-muted',
        )}
      >
        {icon}
        {label}
      </span>
    </Tip>
  )
}

function EventPill({
  event,
  memberName,
  memberNameFor,
}: {
  event: InboxEvent
  memberName?: string
  memberNameFor?: MemberNameResolver
}) {
  const { t, i18n } = useTranslation('communication')
  const { ai, icon } = eventPresentation(event.eventType, event.payload ?? {})
  const when = event.createdAt
    ? new Date(event.createdAt).toLocaleString(i18n.language)
    : undefined
  const pill = (
    <ActivityPill
      label={eventLabel(event, t, memberName, memberNameFor)}
      ai={ai}
      icon={icon}
      tip={when}
    />
  )
  const linkedId = event.eventType === 'split' ? event.payload?.other_signal_id : null
  if (typeof linkedId === 'string' && linkedId) {
    return (
      <Link to={inboxPath('all', linkedId)} className="rounded-full hover:ring-1 hover:ring-border">
        {pill}
      </Link>
    )
  }
  return pill
}

/** Parse a system_event body that accidentally stored a patch JSON blob. */
function parseSystemEventPayload(raw: string): Record<string, unknown> | null {
  const text = raw.trim()
  if (!text.startsWith('{')) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** System messages (contact link, escalate, …) — not teammate notes. */
/** Localized "Handled by phone by Lorenzo" from the server's structured fields. */
export function handledExternallyLabel(
  payload: Record<string, unknown> | undefined,
  t: TFunction,
): string | null {
  const info = payload?.handled_externally
  if (!info || typeof info !== 'object') return null
  const row = info as { channel?: string; by_name?: string; note?: string }
  const channel = ['phone', 'whatsapp', 'email', 'other'].includes(row.channel ?? '')
    ? (row.channel as string)
    : 'other'
  const name = (row.by_name || '').trim() || t('timeline.roleTeam')
  const base = t(`timeline.handledExternally.${channel}`, { name })
  const note = (row.note || '').trim()
  return note ? `${base} - ${note}` : base
}

function SystemEventTimelineItem({ message }: { message: InboxMessage }) {
  const { t } = useTranslation('communication')
  const raw = (message.bodyText || message.bodyPreview || '').trim()
  const handled = handledExternallyLabel(message.payload, t)
  if (handled) {
    return (
      <div className="flex justify-center py-0.5 px-2" data-testid="handled-externally-pill">
        <ActivityPill label={handled} />
      </div>
    )
  }
  const fromPayload =
    message.payload && Object.keys(message.payload).length > 0 ? message.payload : null
  const fromBody = raw ? parseSystemEventPayload(raw) : null
  const patch = fromPayload ?? fromBody
  const label = threadPatchHasMeaning(patch)
    ? EVENT_LABELS.thread_updated(t, patch!)
    : fromBody
      ? null
      : raw
  if (!label) return null
  return (
    <div className="flex justify-center py-0.5 px-2">
      <ActivityPill label={label} />
    </div>
  )
}

// Small role chip next to the author name ("Team" / "AI").
function RoleChip({ kind }: { kind: 'team' | 'ai' }) {
  const { t } = useTranslation('communication')
  return (
    <span
      className={cn(
        'shrink-0 rounded-lg border-0 px-2 py-0.5 text-2xs font-medium leading-none',
        kind === 'ai' ? AI_PILL_CLASS : 'bg-bg-elevated text-text-muted',
      )}
    >
      {kind === 'ai' ? t('timeline.roleAi') : t('timeline.roleTeam')}
    </span>
  )
}

// Email-style block for inbound external mail: full width, left-aligned,
// flat card — HTML newsletters and long mails need the horizontal room.
function EmailMessageBlock({
  avatar,
  header,
  body,
  meta,
  actions,
}: {
  avatar: ReactNode
  header: ReactNode
  body: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="msg-bubble-enter group/bubble flex w-full items-start gap-2">
      <span className="flex w-7 shrink-0 justify-center">{avatar}</span>
      <div className="relative w-full min-w-0 rounded-[18px] rounded-tl-[6px] bg-bg-surface px-3.5 py-2.5 text-base leading-relaxed text-text-primary ring-1 ring-inset ring-border/60">
        {header}
        {body}
        {meta ? (
          <div className="mt-1 flex justify-end text-2xs leading-none text-text-muted tabular-nums">{meta}</div>
        ) : null}
        {actions ? (
          <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-bg-surface/95 p-0.5 opacity-0 shadow-sm ring-1 ring-border/50 transition-opacity group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// Thumbs up/down on agent replies. Votes feed the learning loop
// (`POST /api/messages/{id}/feedback`) and drive the Usage "Avg feedback" metric.
// The correct-interpretation action opens a chat with the responsible agent,
// grounded in this thread, so the operator can explain what should have
// happened and the agent can capture the learning.
function MessageFeedbackControls({
  messageId,
  initial,
  threadId,
  agentId,
  agentName,
  summary,
}: {
  messageId: string
  initial?: InboxMessage['myFeedback']
  threadId?: string
  agentId?: string | null
  agentName?: string | null
  summary?: string
}) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [sentiment, setSentiment] = useState<'up' | 'down' | null>(initial?.sentiment ?? null)
  const [busy, setBusy] = useState(false)
  const { startCorrection, starting } = useCorrectionChat()

  const vote = useCallback(
    async (value: 'up' | 'down') => {
      if (!token || busy || sentiment === value) return
      const previous = sentiment
      setSentiment(value)
      setBusy(true)
      try {
        await submitMessageFeedback(token, messageId, value)
      } catch {
        setSentiment(previous)
        toast.error(t('decisionCard.feedbackError'))
      } finally {
        setBusy(false)
      }
    },
    [token, busy, sentiment, messageId, t],
  )

  const buttonClass = (active: boolean) =>
    cn(
      'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
      active ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
    )

  const correctLabel = t('decisionCard.correctInterpretation')

  return (
    <div className="flex items-center gap-0.5 border-r border-border/50 pr-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('decisionCard.feedbackGood')}
            className={buttonClass(sentiment === 'up')}
            onClick={() => vote('up')}
          >
            <ThumbsUp size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('decisionCard.feedbackGood')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('decisionCard.feedbackPoor')}
            className={buttonClass(sentiment === 'down')}
            onClick={() => vote('down')}
          >
            <ThumbsDown size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('decisionCard.feedbackPoor')}</TooltipContent>
      </Tooltip>
      {threadId ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={correctLabel}
              disabled={starting}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
              onClick={() =>
                void startCorrection({
                  threadId,
                  agentId,
                  agentName,
                  subjectType: 'message',
                  subjectId: messageId,
                  summary,
                })
              }
            >
              {starting ? <Loader2 size={12} className="animate-spin" /> : <MessageSquareWarning size={12} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{correctLabel}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

export function MessageTimelineItem({
  message: messageProp,
  threadId,
  channel,
  layout = 'chat',
  contactName,
  contactEmail,
  contactPhone,
  membersById,
  noteActions,
  agentName,
  agentId,
  agentAvatarKind,
  agentAvatarIcon,
  agentAvatarColor,
  agentAvatarImageUrl,
  stack = 'single',
}: MessageItemProps) {
  const { t, i18n } = useTranslation('communication')
  const confirm = useConfirm()
  const { user, token } = useAuth()
  const [enriched, setEnriched] = useState<Pick<
    InboxMessage,
    'bodyHtml' | 'hasHtml' | 'activity' | 'activityAfter' | 'activityDetail'
  > | null>(null)
  const [enriching, setEnriching] = useState(false)
  const message = enriched ? { ...messageProp, ...enriched } : messageProp
  // Contact link / escalate / handover write kind=system_event with no author.
  const isSystemEvent = message.kind === 'system_event'

  const ensureFullMessage = useCallback(async () => {
    if (!token || !threadId) return message
    const needsActivity = Boolean(message.hasActivity) && !message.activityDetail
    const needsHtml = Boolean(message.hasHtml) && !message.bodyHtml
    if (!needsActivity && !needsHtml) return message
    if (enriching) return message
    setEnriching(true)
    try {
      const full = await getMessage(token, threadId, String(message.id))
      if (!full) return message
      const next = {
        bodyHtml: full.bodyHtml,
        hasHtml: full.hasHtml ?? Boolean(full.bodyHtml),
        activity: full.activity,
        activityAfter: full.activityAfter,
        activityDetail: true,
      }
      setEnriched(next)
      return { ...message, ...next }
    } catch {
      return message
    } finally {
      setEnriching(false)
    }
  }, [token, threadId, message, enriching])

  // Timeline windows may omit body_html while has_html is true — fetch once
  // so HTML mail never stays stuck on a messy plain-text fallback.
  useEffect(() => {
    if (!token || !threadId) return
    if (!message.hasHtml || message.bodyHtml) return
    void ensureFullMessage()
  }, [token, threadId, message.hasHtml, message.bodyHtml, ensureFullMessage])

  const currentUserId = user?.id ?? null
  const isInternal = message.direction === 'internal'
  const isOutbound = message.direction === 'outbound'
  const isInbound = !isInternal && !isOutbound

  // Inline editing state for internal notes (kind "internal_note").
  const isEditableNote =
    isInternal && message.kind === 'internal_note' && noteActions != null && typeof message.id === 'string'
  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)

  const startNoteEdit = useCallback(() => {
    setNoteDraft(message.bodyText || message.bodyPreview || '')
    setEditingNote(true)
  }, [message.bodyText, message.bodyPreview])

  const saveNote = useCallback(async () => {
    if (!noteActions || noteBusy) return
    const text = noteDraft.trim()
    if (!text) return
    setNoteBusy(true)
    try {
      await noteActions.onEdit(String(message.id), text)
      setEditingNote(false)
    } catch {
      toast.error(t('composer.noteUpdateError'))
    } finally {
      setNoteBusy(false)
    }
  }, [noteActions, noteBusy, noteDraft, message.id, t])

  const removeNote = useCallback(async () => {
    if (!noteActions || noteBusy) return
    if (!(await confirm({ description: t('composer.deleteNoteConfirm'), destructive: true }))) return
    setNoteBusy(true)
    try {
      await noteActions.onDelete(String(message.id))
    } catch {
      toast.error(t('composer.noteDeleteError'))
      setNoteBusy(false)
    }
  }, [noteActions, noteBusy, message.id, t, confirm])

  // Same centered activity pill as SignalEvents — never "Teamlid / Interne notitie".
  if (isSystemEvent) {
    return <SystemEventTimelineItem message={message} />
  }

  // Resolve author info for outbound / internal bubbles
  const authorFromId =
    message.authorUserId != null ? membersById?.[Number(message.authorUserId)] : undefined
  const authorFromEmail = (() => {
    const address = (message.fromAddress || '').trim().toLowerCase()
    if (!address || !membersById) return undefined
    return Object.values(membersById).find((m) => m.email?.toLowerCase() === address)
  })()
  const author = authorFromId ?? authorFromEmail
  // Reply a colleague sent from their own Outlook/Gmail, logged via Sent
  // items. Without a matching member the mail's own sender name is shown.
  const externalMailbox = message.payload?.origin === 'external_mailbox'
  const mailboxProviderLabel = (() => {
    const provider = String(message.payload?.mailbox_provider ?? '')
    if (provider === 'outlook') return 'Outlook'
    if (provider === 'gmail') return 'Gmail'
    return String(message.payload?.mailbox ?? '') || provider
  })()
  const externalSenderName =
    typeof message.payload?.sender_name === 'string' && message.payload.sender_name.trim()
      ? message.payload.sender_name.trim()
      : message.fromAddress || ''
  const authorName =
    author?.name ??
    (externalMailbox && externalSenderName
      ? externalSenderName
      : isOutbound
        ? t('timeline.events.you')
        : t('timeline.events.teamMember'))
  const authorEmail = author?.email ?? (externalMailbox ? message.fromAddress || '' : '')
  const forwardedFrom = (() => {
    const raw = message.payload?.forwarded_from
    if (!raw || typeof raw !== 'object') return null
    const row = raw as { name?: unknown; email?: unknown }
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const email = typeof row.email === 'string' ? row.email.trim() : ''
    return name || email ? { name, email } : { name: '', email: '' }
  })()
  const authorAvatarUrl = author?.avatarUrl ?? null

  // Inbound contact info: prefer thread contact, fallback to message fromAddress
  const inboundEmail = message.fromAddress || contactEmail || ''
  const inboundName = contactName || inboundEmail || t('timeline.events.sender')

  const attachmentItems: MessageAttachment[] = asMessageAttachments(message.attachments)

  const isAgentMessage =
    message.kind === 'agent_message' ||
    Boolean(message.payload?.agent_id) ||
    Boolean(message.hasActivity)

  const plainBody =
    message.bodyText ||
    message.bodyPreview ||
    (message.bodyHtml
      ? htmlToPlainPreview(message.bodyHtml)
      : '')
  const displayBody = translateMockAgentBody(plainBody, t)
  // Prefer HTML whenever we have it (or the plain body is mislabelled HTML).
  // Mock translations still force the plain path so i18n placeholders work.
  const htmlSource =
    (message.bodyHtml && message.bodyHtml.trim()) ||
    (looksLikeEmailHtml(message.bodyText) ? message.bodyText!.trim() : '') ||
    ''
  const usePlainBody = displayBody !== plainBody || !htmlSource

  const bubbleBody = editingNote ? (
    <div className="space-y-1.5">
      <textarea
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        rows={Math.min(8, Math.max(2, noteDraft.split('\n').length))}
        autoFocus
        disabled={noteBusy}
        className="w-full min-w-52 resize-y rounded-md border border-border/60 bg-bg-surface px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={noteBusy || !noteDraft.trim()}
          onClick={() => void saveNote()}
          className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-40"
        >
          {t('timeline.events.save')}
        </button>
        <button
          type="button"
          disabled={noteBusy}
          onClick={() => setEditingNote(false)}
          className="rounded-md px-2 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          {t('composer.cancel')}
        </button>
      </div>
    </div>
  ) : usePlainBody ? (
    <div className="space-y-1">
      {enriching && message.hasHtml ? (
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          <span>{t('timeline.events.emailContent')}</span>
        </div>
      ) : (
        <ChatText content={displayBody} />
      )}
      <MessageAttachments attachments={attachmentItems.filter((a) => !a.inline)} />
    </div>
  ) : (
    <div className="space-y-1">
      <MessageHtmlBody
        html={htmlSource}
        plainText={message.bodyText || message.bodyPreview || undefined}
        attachments={attachmentItems}
      />
      <MessageAttachments attachments={attachmentItems.filter((a) => !a.inline)} />
    </div>
  )

  const contactAvatar = (
    <ContactAvatarWithHover email={inboundEmail} name={inboundName} phone={contactPhone} size={28} />
  )
  const agentAvatar = (
    <AiAvatar
      {...toAiAvatarProps(
        {
          name: agentName,
          agentId,
          agentAvatarKind,
          agentAvatarIcon,
          agentAvatarColor,
          agentAvatarImageUrl,
        },
        t('timeline.aiAgent'),
      )}
      size={28}
      decorative
    />
  )

  // Group-chat author model: customer (external), teammate, AI agent, or the
  // signed-in user. Workspace members are never "external" — even on inbound
  // mail from their login address (e.g. teammate wrote into a shared inbox).
  const myEmail = user?.email?.trim().toLowerCase() || ''
  const fromEmail = (message.fromAddress || '').trim().toLowerCase()
  const isOwn =
    !isAgentMessage &&
    ((message.authorUserId != null &&
      currentUserId != null &&
      Number(message.authorUserId) === Number(currentUserId)) ||
      (Boolean(myEmail) && Boolean(fromEmail) && myEmail === fromEmail) ||
      (Boolean(myEmail) && Boolean(author?.email) && myEmail === author?.email?.toLowerCase()))
  const isWorkspaceMember = Boolean(author) || isOwn
  const authorKind: 'external' | 'agent' | 'self' | 'teammate' = isAgentMessage
    ? 'agent'
    : isOwn
      ? 'self'
      : isWorkspaceMember
        ? 'teammate'
        : isInbound
          ? 'external'
          : 'teammate'

  // Prefer the signed-in profile for own bubbles (notes included) so the
  // avatar stays correct even when the message author is not in membersById.
  const userAvatar = (
    <UserAvatar
      name={isOwn ? user?.name?.trim() || authorName : authorName}
      email={isOwn ? user?.email || authorEmail || authorName : authorEmail || authorName}
      avatarUrl={isOwn ? user?.avatarUrl ?? authorAvatarUrl : authorAvatarUrl}
      size={28}
    />
  )

  const sendFailed =
    typeof message.sendStatus === 'string' && message.sendStatus.startsWith('failed')

  const noteEditControls =
    isEditableNote && !editingNote ? (
      <>
        <BubbleAction label={t('timeline.events.editNote')} disabled={noteBusy} onClick={startNoteEdit}>
          <Pencil size={12} />
        </BubbleAction>
        <BubbleAction
          label={t('timeline.events.deleteNote')}
          disabled={noteBusy}
          onClick={() => void removeNote()}
        >
          <Trash2 size={12} />
        </BubbleAction>
      </>
    ) : null

  const inboundHeader = (
    <BubbleHeader
      name={inboundName}
      subtitle={inboundEmail && inboundEmail !== inboundName ? inboundEmail : undefined}
    />
  )

  // Header per author type. Own customer replies skip the name; internal
  // notes always show who wrote them (avatar + name) because authorship is
  // the main signal on a team-only message.
  const header = (() => {
    if (isInternal) {
      return (
        <BubbleHeader
          name={isOwn ? t('timeline.events.you') : authorName}
          subtitle={t('timeline.internalNote')}
        />
      )
    }
    if (authorKind === 'external') return inboundHeader
    if (authorKind === 'agent') {
      const mockOrPlaceholder =
        Boolean(message.isMock) ||
        isMockAgentBody(message.bodyText) ||
        isMockAgentBody(message.bodyPreview)
      const delivered = !mockOrPlaceholder && message.deliveredToCustomer === true
      // Assistant and internal threads have no customer: no delivery label.
      const agentSubtitle = !isOutbound || !isCustomerChannel(channel)
        ? undefined
        : mockOrPlaceholder
          ? t('timeline.mockNotSent')
          : delivered
            ? t('timeline.sentToCustomer')
            : t('timeline.notDelivered')
      return (
        <BubbleHeader
          name={agentName || t('timeline.aiAgent')}
          chip={<RoleChip kind="ai" />}
          subtitle={agentSubtitle}
        />
      )
    }
    if (authorKind === 'teammate') {
      return (
        <BubbleHeader
          name={authorName}
          chip={<RoleChip kind="team" />}
          subtitle={
            externalMailbox
              ? t('timeline.sentFromOwnMailbox', { provider: mailboxProviderLabel })
              : undefined
          }
        />
      )
    }
    return null
  })()

  // Provenance lines inside the bubble: a reply logged from a colleague's
  // own mailbox, or a teammate forwarding someone else's mail.
  const provenanceLine = (() => {
    const rows: string[] = []
    if (externalMailbox && authorKind === 'self') {
      rows.push(t('timeline.sentFromOwnMailbox', { provider: mailboxProviderLabel }))
    }
    if (forwardedFrom) {
      const who = forwardedFrom.name || forwardedFrom.email
      rows.push(
        who
          ? t('timeline.forwardedFrom', { name: who })
          : t('timeline.forwardedUnknown'),
      )
    }
    if (rows.length === 0) return null
    return (
      <div className="mb-1 space-y-0.5" data-testid="message-provenance">
        {rows.map((row) => (
          <div key={row} className="truncate-fade text-2xs text-text-muted" title={row}>
            {row}
          </div>
        ))}
      </div>
    )
  })()

  // Own messages carry no name; delivery problems and the soft-undo window
  // render inside the bubble so they stay visible mid-run.
  const selfStatusLine = (() => {
    if (authorKind !== 'self' || isInternal) return null
    if (sendFailed) {
      // Translate known failure codes so the operator knows what to do
      // (reconnect the mailbox vs just retry) instead of a bare label.
      const failCode = String(message.sendStatus).replace(/^failed:/, '')
      const failReasonKey: Record<string, string> = {
        auth_expired: 'timeline.deliveryFail.authExpired',
        no_credentials: 'timeline.deliveryFail.noMailbox',
        no_account: 'timeline.deliveryFail.noMailbox',
        network: 'timeline.deliveryFail.network',
        no_recipient: 'timeline.deliveryFail.noRecipient',
      }
      const failReason = failReasonKey[failCode]
        ? t(failReasonKey[failCode])
        : t('timeline.deliveryFail.unknown')
      return (
        <div className="mb-1 flex min-w-0 items-center gap-1">
          <span
            className="truncate-fade text-2xs font-medium text-status-error"
            title={String(message.sendStatus)}
          >
            {t('timeline.notDelivered')}
            {failReason ? ` - ${failReason}` : ''}
          </span>
          {displayBody ? (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(displayBody).then(
                  () => toast.success(t('timeline.bodyCopied')),
                  () => toast.error(t('timeline.copyFailed')),
                )
              }}
              className="text-2xs font-medium text-accent hover:underline"
            >
              {t('timeline.copyBody')}
            </button>
          ) : null}
        </div>
      )
    }
    if (message.sendStatus === 'scheduled') {
      return (
        <div className="mb-1 flex min-w-0 items-center gap-1">
          <span className="text-2xs font-medium text-text-muted">{t('timeline.sending')}</span>
          {token && typeof message.id === 'string' ? (
            <button
              type="button"
              onClick={() => {
                void cancelScheduledMessage(token, String(message.id)).then(
                  () => toast.success(t('timeline.sendCancelled')),
                  () => toast.error(t('timeline.cancelSendFailed')),
                )
              }}
              className="text-2xs font-medium text-accent hover:underline"
            >
              {t('timeline.cancelSend')}
            </button>
          ) : null}
        </div>
      )
    }
    return null
  })()

  const avatar =
    authorKind === 'external' ? contactAvatar : authorKind === 'agent' ? agentAvatar : userAvatar
  const variant: BubbleVariant = isInternal
    ? 'note'
    : authorKind === 'external'
      ? 'external'
      : authorKind === 'agent'
        ? 'agent'
        : authorKind === 'self'
          ? 'self'
          : 'team'
  const side: 'left' | 'right' = isOwn ? 'right' : 'left'

  const feedbackRow =
    isAgentMessage && typeof message.id === 'string' ? (
      <MessageFeedbackControls
        messageId={message.id}
        initial={message.myFeedback}
        threadId={String(message.threadId)}
        agentId={typeof message.payload?.agent_id === 'string' ? message.payload.agent_id : null}
        agentName={agentName}
        summary={message.bodyText || message.bodyPreview || ''}
      />
    ) : null

  // Email threads: inbound external mail keeps the full-width card (HTML
  // newsletters need the room); everything else uses the chat bubble model so
  // your own replies land on the right there too.
  const useFullWidthEmailCard = layout === 'email' && authorKind === 'external' && !isInternal

  // Outbound email: show CC recipients so the sender can verify who was copied.
  const ccLine =
    layout === 'email' && message.cc ? (
      <div className="mb-1 truncate-fade text-2xs text-text-muted" title={message.cc}>
        {t('timeline.ccLine', { recipients: message.cc })}
      </div>
    ) : null
  const bubbleBodyWithMeta =
    ccLine || selfStatusLine || provenanceLine ? (
      <div>
        {selfStatusLine}
        {provenanceLine}
        {ccLine}
        {bubbleBody}
      </div>
    ) : (
      bubbleBody
    )

  const sentAt = message.receivedAt ?? message.createdAt
  const timeMeta = sentAt ? (
    <time dateTime={sentAt} title={new Date(sentAt).toLocaleString(i18n.language)}>
      {formatHourMinute(sentAt, i18n.language)}
    </time>
  ) : null

  const copyAction =
    displayBody && !sendFailed && !editingNote ? (
      <BubbleAction
        label={t('timeline.copyBody')}
        onClick={() => {
          void navigator.clipboard.writeText(displayBody).then(
            () => toast.success(t('timeline.bodyCopied')),
            () => toast.error(t('timeline.copyFailed')),
          )
        }}
      >
        <Copy size={12} />
      </BubbleAction>
    ) : null
  const splitAction =
    isInbound && authorKind === 'external' && threadId && typeof message.id === 'string' && isCustomerChannel(channel) ? (
      <SplitConversationAction threadId={String(threadId)} messageId={message.id} />
    ) : null
  const actions =
    copyAction || feedbackRow || noteEditControls || splitAction ? (
      <>
        {feedbackRow}
        {noteEditControls}
        {copyAction}
        {splitAction}
      </>
    ) : null

  const bubble = useFullWidthEmailCard ? (
    <EmailMessageBlock
      avatar={contactAvatar}
      header={inboundHeader}
      body={bubbleBodyWithMeta}
      meta={timeMeta}
      actions={actions}
    />
  ) : (
    <ChatMessageBubble
      side={side}
      avatar={avatar}
      header={header}
      body={bubbleBodyWithMeta}
      meta={timeMeta}
      actions={actions}
      variant={variant}
      stack={stack}
    />
  )

  const workJobId =
    typeof message.payload?.work_job_id === 'string' ? message.payload.work_job_id : null
  const workbenchCard = workJobId ? (
    <WorkbenchJobCard
      jobId={workJobId}
      provider={
        typeof message.payload?.workbench_provider === 'string'
          ? message.payload.workbench_provider
          : undefined
      }
      kind={
        typeof message.payload?.workbench_kind === 'string'
          ? message.payload.workbench_kind
          : undefined
      }
      className={isOwn ? 'ml-auto' : 'ml-9'}
    />
  ) : null

  const activityBefore = message.activity ?? []
  const activityAfter = message.activityAfter ?? []
  if (activityBefore.length === 0 && activityAfter.length === 0) {
    if (!workbenchCard) return bubble
    return (
      <div className={cn('flex flex-col gap-1', isOwn ? 'items-end' : 'items-start')}>
        <div className="w-full">{bubble}</div>
        {workbenchCard}
      </div>
    )
  }

  const traceIndent = isOwn ? 'ml-auto' : 'ml-9'
  const loadDetail = message.activityDetail ? undefined : () => void ensureFullMessage()
  return (
    <div className={cn('flex flex-col gap-1', isOwn ? 'items-end' : 'items-start')}>
      {activityBefore.length > 0 ? (
        <ActivityTrail items={activityBefore} onExpand={loadDetail} className={traceIndent} />
      ) : null}
      <div className="w-full">{bubble}</div>
      {activityAfter.length > 0 ? (
        <ActivityTrail items={activityAfter} onExpand={loadDetail} className={traceIndent} />
      ) : null}
      {workbenchCard}
    </div>
  )
}

export function EventTimelineItem({ event, memberName, memberNameFor }: EventItemProps) {
  return (
    <div className="flex justify-center py-0.5 px-2">
      <EventPill event={event} memberName={memberName} memberNameFor={memberNameFor} />
    </div>
  )
}

// Consecutive events render as one compact centered cluster of pills instead
// of a stack of full-width divider lines.
export function EventClusterTimelineItem({
  events,
  time,
  memberNameFor,
}: {
  events: InboxEvent[]
  time?: string
  memberNameFor: MemberNameResolver
}) {
  const { i18n } = useTranslation('communication')
  if (events.length === 0) return null
  const clock = time ? formatHourMinute(time, i18n.language) : ''
  const pills =
    events.length === 1 ? (
      <EventTimelineItem
        event={events[0]}
        memberName={memberNameFor(events[0].actorUserId)}
        memberNameFor={memberNameFor}
      />
    ) : (
      <div className="flex flex-wrap items-center justify-center gap-1 py-0.5 px-2">
        {events.map((event) => (
          <EventPill
            key={event.id}
            event={event}
            memberName={memberNameFor(event.actorUserId)}
            memberNameFor={memberNameFor}
          />
        ))}
      </div>
    )
  if (!clock) return pills
  return (
    <div className="flex flex-col items-center gap-1">
      <time
        dateTime={time}
        className="text-2xs font-medium text-text-muted/80"
        title={time ? new Date(time).toLocaleString(i18n.language) : undefined}
      >
        {clock}
      </time>
      {pills}
    </div>
  )
}
