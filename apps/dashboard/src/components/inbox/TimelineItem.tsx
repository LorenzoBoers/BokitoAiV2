import { Check, Loader2, Mail, MessageSquareWarning, Pencil, Phone, StickyNote, Text, ThumbsDown, ThumbsUp, Trash2, User, X as XIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { translateMockAgentBody } from '../../lib/activity-labels'
import { cn } from '../../lib/utils'
import { cancelScheduledMessage, submitMessageFeedback } from '../../lib/signals-api'
import { useCorrectionChat } from '../../lib/correction-chat'
import { PersonAvatar } from '../ui/PersonAvatar'
import { UserAvatar } from '../ui/UserAvatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { formatAppTime } from '../../lib/app-locale'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import type { InboxEvent, InboxMessage, InboxMember, MessageAttachment } from '../../lib/inbox-api'
import { mentionMarkupToHtmlChips } from '../../lib/mentions'
import { AI_CARD_CLASS, AI_PILL_CLASS, AiIconBox, AiMark } from '../ai/AiMark'
import MessageAttachments from './MessageAttachments'
import MessageMarkdown from './MessageMarkdown'
import ReasoningDisclosure from './ReasoningDisclosure'

type MessageLayout = 'chat' | 'email'

/** Edit/delete callbacks for internal notes; omit to render notes read-only. */
export type NoteActions = {
  onEdit: (messageId: string, bodyText: string) => Promise<void>
  onDelete: (messageId: string) => Promise<void>
}

type MessageItemProps = {
  message: InboxMessage
  layout?: MessageLayout
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  membersById?: Record<number, InboxMember>
  noteActions?: NoteActions
  /** Name of the agent bound to this thread, shown on AI messages. */
  agentName?: string | null
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
          <span className="text-xs font-semibold truncate">{name}</span>
        </div>
      ) : null}
      {hasEmail ? (
        <div className="flex items-center gap-2">
          <Mail size={12} className="text-text-muted shrink-0" />
          <a
            href={`mailto:${email}`}
            className="text-[11px] text-text-secondary truncate hover:text-accent"
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
            className="text-[11px] text-text-secondary truncate hover:text-accent"
            onClick={(e) => e.stopPropagation()}
          >
            {phone}
          </a>
        </div>
      ) : null}
    </div>
  )
}

// Person avatar (initials, or question mark for unknown visitors). Wrapped
// in a hover tooltip showing name / email / phone (whatever is available).
function ContactAvatar({
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
    <PersonAvatar name={name} email={email} size={size} className="cursor-default" />
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

function SimpleMessageHtml({ html }: { html: string }) {
  return (
    <div
      className="text-xs text-text-primary leading-relaxed break-words [&_img]:mt-4 [&_img]:block [&_img]:max-w-[260px] [&_img]:h-auto"
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
  const [height, setHeight] = useState(80)

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
    setHeight(next)
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

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (doc && isDark) applyDarkTheme(doc)
    measure()
    if (!doc) return
    doc.querySelectorAll('img').forEach((img) => {
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
  const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
html { background: transparent; }
html, body { margin: 0; padding: 0; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.5; word-break: break-word; }
body { padding: 2px 0; background: transparent; }
img { max-width: 100%; height: auto; }
table { max-width: 100% !important; }
a { color: #2563eb; }
</style></head><body><div id="bokito-email-root">${html}</div></body></html>`

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={wrappedHtml}
      onLoad={handleLoad}
      title={t('timeline.events.emailContent')}
      className="block w-full bg-transparent"
      style={{
        height: `${height}px`,
        border: 0,
        background: 'transparent',
        colorScheme: 'light',
      }}
    />
  )
}

function MessageHtmlBody({ html }: { html: string }) {
  const { isDark } = useTheme()
  if (isSimpleMessageHtml(html)) {
    return <SimpleMessageHtml html={html} />
  }
  return <EmailHtmlFrame html={html} isDark={isDark} />
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
  no_reply_noted: (t) => t('timeline.events.noReplyNoted'),
  agent_invoked: (t) => t('timeline.events.agentInvoked'),
  agent_replied: (t) => t('timeline.events.agentReplied'),
  suggestion_created: (t) => t('timeline.events.suggestionCreated'),
  decision_created: (t) => t('timeline.events.decisionCreated'),
  triaged: (t) => t('timeline.events.triaged'),
  escalated: (t) => t('timeline.events.escalated'),
  ai_paused: (t) => t('timeline.events.aiPaused'),
  ai_resumed: (t) => t('timeline.events.aiResumed'),
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
    return t('timeline.events.handledByRule', { target })
  },
}

// Events that belong to the AI flow get the unified accent treatment so agent
// activity reads as one visual system instead of scattered divider lines.
const AI_EVENT_TYPES = new Set([
  'agent_processed',
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

function eventPresentation(eventType: string): { ai: boolean; icon: ReactNode } {
  if (eventType === 'decision_approved') return { ai: true, icon: <Check size={10} /> }
  if (eventType === 'decision_dismissed') return { ai: true, icon: <XIcon size={10} /> }
  if (AI_EVENT_TYPES.has(eventType) || (eventType && eventType.startsWith('decision_'))) {
    return { ai: true, icon: <AiMark size={10} /> }
  }
  return { ai: false, icon: null }
}

function humanizeEventType(eventType: string): string {
  const text = eventType.replace(/[_-]+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function eventLabel(
  event: InboxEvent,
  t: TFunction,
  memberName?: string,
  memberNameFor?: MemberNameResolver,
): string {
  const labelFn = EVENT_LABELS[event.eventType]
  return labelFn
    ? labelFn(t, event.payload, memberName, memberNameFor)
    : humanizeEventType(event.eventType)
}

// Compact centered pill for a single timeline event. AI-flow events share one
// accent-tinted style (purple + sparkles); plain system events stay muted.
function EventPill({
  event,
  memberName,
  memberNameFor,
}: {
  event: InboxEvent
  memberName?: string
  memberNameFor?: MemberNameResolver
}) {
  const { t } = useTranslation('communication')
  const { ai, icon } = eventPresentation(event.eventType)
  const payloadTitle =
    event.payload && Object.keys(event.payload).length > 0
      ? JSON.stringify(event.payload)
      : undefined
  return (
    <span
      title={payloadTitle}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-4 whitespace-nowrap',
        ai
          ? cn(AI_PILL_CLASS, 'ai-glow')
          : 'border-border/40 bg-bg-surface text-text-muted',
      )}
    >
      {icon}
      {eventLabel(event, t, memberName, memberNameFor)}
    </span>
  )
}

// Visual identity per author type — the "group chat" model: customers,
// teammates and AI agents each have a distinct bubble; only the signed-in
// user's own messages sit on the right (like WhatsApp / iMessage).
type BubbleVariant = 'external' | 'team' | 'agent' | 'self' | 'note'

const BUBBLE_VARIANT_CLASSES: Record<BubbleVariant, string> = {
  external: 'bg-bg-surface border-border/60',
  team: 'bg-bg-elevated/80 border-border/60',
  agent: AI_CARD_CLASS,
  self: 'bg-accent/15 border-accent/30',
  // Notes use a dedicated left-rule layout — this class is unused for notes.
  note: 'border-transparent bg-transparent',
}

// Small role chip next to the author name ("Team" / "AI").
function RoleChip({ kind }: { kind: 'team' | 'ai' }) {
  const { t } = useTranslation('communication')
  return (
    <span
      className={cn(
        'shrink-0 rounded border px-1 py-px text-[9px] font-medium uppercase tracking-wide leading-3',
        kind === 'ai'
          ? AI_PILL_CLASS
          : 'border-border/60 bg-bg-elevated text-text-muted',
      )}
    >
      {kind === 'ai' ? t('timeline.roleAi') : t('timeline.roleTeam')}
    </span>
  )
}

// Chat-style bubble: avatar on one side, message bubble constrained to a
// portion of the width so left/right alignment is clearly visible.
function ChatMessageBubble({
  side,
  avatar,
  header,
  body,
  variant,
}: {
  side: 'left' | 'right'
  avatar: ReactNode
  header: ReactNode
  body: ReactNode
  variant: BubbleVariant
}) {
  const isRight = side === 'right'
  return (
    <div className={cn('flex items-end gap-2', isRight ? 'justify-end' : 'justify-start')}>
      {isRight ? null : avatar}
      <div
        className={cn(
          'max-w-[78%] min-w-0 rounded-2xl border px-3 py-2',
          isRight ? 'rounded-br-sm' : 'rounded-bl-sm',
          BUBBLE_VARIANT_CLASSES[variant],
        )}
      >
        {header}
        {body}
      </div>
      {isRight ? avatar : null}
    </div>
  )
}

// Email-style block for inbound external mail: full width, left-aligned,
// flat card — HTML newsletters and long mails need the horizontal room.
function EmailMessageBlock({
  avatar,
  header,
  body,
}: {
  avatar: ReactNode
  header: ReactNode
  body: ReactNode
}) {
  return (
    <div className="flex w-full items-start gap-2">
      {avatar}
      <div className="w-full min-w-0 rounded-lg border px-3 py-2 bg-bg-surface border-border/60">
        {header}
        {body}
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
      'flex h-5 w-5 items-center justify-center rounded transition-colors',
      active ? 'text-accent bg-accent/10' : 'text-text-muted/60 hover:text-text-body hover:bg-bg-hover/60',
    )

  const correctLabel = t('decisionCard.correctInterpretation')

  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('decisionCard.feedbackGood')}
            className={buttonClass(sentiment === 'up')}
            onClick={() => vote('up')}
          >
            <ThumbsUp size={11} />
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
            <ThumbsDown size={11} />
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
              className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-text-muted/60 transition-colors hover:bg-bg-hover/60 hover:text-text-body disabled:opacity-50"
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
              {starting ? <Loader2 size={11} className="animate-spin" /> : <MessageSquareWarning size={11} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{correctLabel}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

export function MessageTimelineItem({ message, layout = 'chat', contactName, contactEmail, contactPhone, membersById, noteActions, agentName }: MessageItemProps) {
  const { t } = useTranslation('communication')
  const { user, token } = useAuth()
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
    if (!window.confirm(t('composer.deleteNoteConfirm'))) return
    setNoteBusy(true)
    try {
      await noteActions.onDelete(String(message.id))
    } catch {
      toast.error(t('composer.noteDeleteError'))
      setNoteBusy(false)
    }
  }, [noteActions, noteBusy, message.id, t])

  // Resolve author info for outbound / internal bubbles
  const authorFromId =
    message.authorUserId != null ? membersById?.[Number(message.authorUserId)] : undefined
  const authorFromEmail = (() => {
    const address = (message.fromAddress || '').trim().toLowerCase()
    if (!address || !membersById) return undefined
    return Object.values(membersById).find((m) => m.email?.toLowerCase() === address)
  })()
  const author = authorFromId ?? authorFromEmail
  const authorName = author?.name ?? (isOutbound ? t('timeline.events.you') : t('timeline.events.teamMember'))
  const authorEmail = author?.email ?? ''
  const authorAvatarUrl = author?.avatarUrl ?? null

  // Inbound contact info: prefer thread contact, fallback to message fromAddress
  const inboundEmail = message.fromAddress || contactEmail || ''
  const inboundName = contactName || inboundEmail || t('timeline.events.sender')

  const attachmentItems: MessageAttachment[] = Array.isArray(message.attachments)
    ? message.attachments.filter(
        (a): a is MessageAttachment =>
          !!a &&
          typeof a === 'object' &&
          typeof (a as MessageAttachment).id === 'string' &&
          typeof (a as MessageAttachment).url === 'string',
      )
    : []

  const isAgentMessage =
    message.kind === 'agent_message' ||
    Boolean(message.payload?.agent_id) ||
    Boolean(message.agentTrace)

  const plainBody =
    message.bodyText ||
    message.bodyPreview ||
    (message.bodyHtml
      ? message.bodyHtml
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '')
  const displayBody = translateMockAgentBody(plainBody, t)
  const usePlainBody = displayBody !== plainBody || !message.bodyHtml

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
          className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-40"
        >
          {t('timeline.events.save')}
        </button>
        <button
          type="button"
          disabled={noteBusy}
          onClick={() => setEditingNote(false)}
          className="rounded-md px-2 py-1 text-[11px] text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          {t('composer.cancel')}
        </button>
      </div>
    </div>
  ) : usePlainBody ? (
    <div className="space-y-1">
      <MessageMarkdown text={displayBody} />
      <MessageAttachments attachments={attachmentItems} />
    </div>
  ) : (
    <MessageHtmlBody html={message.bodyHtml ?? ''} />
  )

  const contactAvatar = (
    <ContactAvatar email={inboundEmail} name={inboundName} phone={contactPhone} size={28} />
  )
  const userAvatar = (
    <UserAvatar name={authorName} email={authorEmail || authorName} avatarUrl={authorAvatarUrl} size={28} />
  )
  const agentAvatar = (
    <AiIconBox />
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
      (Boolean(myEmail) && Boolean(author?.email) && myEmail === author.email.toLowerCase()))
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

  const sendFailed =
    typeof message.sendStatus === 'string' && message.sendStatus.startsWith('failed')

  const noteEditControls =
    isEditableNote && !editingNote ? (
      <span className="ml-auto flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          aria-label={t('timeline.events.editNote')}
          disabled={noteBusy}
          onClick={startNoteEdit}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted/50 hover:bg-bg-hover/60 hover:text-text-primary transition-colors disabled:opacity-40"
        >
          <Pencil size={10} />
        </button>
        <button
          type="button"
          aria-label={t('timeline.events.deleteNote')}
          disabled={noteBusy}
          onClick={() => void removeNote()}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted/50 hover:bg-status-error/10 hover:text-status-error transition-colors disabled:opacity-40"
        >
          <Trash2 size={10} />
        </button>
      </span>
    ) : null

  const inboundHeader = (
    <div className="flex items-baseline gap-1.5 mb-1 min-w-0">
      <span className="font-medium text-text-heading text-xs truncate">{inboundName}</span>
      {inboundEmail && inboundEmail !== inboundName ? (
        <span className="text-[10px] text-text-muted truncate">{inboundEmail}</span>
      ) : null}
    </div>
  )

  // Header per author type. Own messages skip the name (it is obviously you);
  // notes and failed sends still surface their affordances.
  const header = (() => {
    if (isInternal) {
      return (
        <div className="flex items-center gap-1.5 mb-1 min-w-0">
          <StickyNote size={12} className="shrink-0 text-text-muted" />
          {!isOwn ? (
            <span className="font-medium text-text-heading text-xs truncate">{authorName}</span>
          ) : null}
          <span className="text-[10px] text-text-muted shrink-0">{t('timeline.internalNote')}</span>
          {noteEditControls}
        </div>
      )
    }
    if (authorKind === 'external') return inboundHeader
    if (authorKind === 'agent') {
      return (
        <div className="mb-1 flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-text-heading">
            {agentName || t('timeline.aiAgent')}
          </span>
          <RoleChip kind="ai" />
        </div>
      )
    }
    if (authorKind === 'teammate') {
      return (
        <div className="mb-1 flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-text-heading">{authorName}</span>
          <RoleChip kind="team" />
        </div>
      )
    }
    // self: no name header — only a delivery error when sending failed, or a
    // pending marker while the soft-undo window is open.
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
            className="truncate text-[10px] font-medium text-status-error"
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
              className="text-[10px] font-medium text-accent hover:underline"
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
          <span className="text-[10px] font-medium text-text-muted">{t('timeline.sending')}</span>
          {token && typeof message.id === 'string' ? (
            <button
              type="button"
              onClick={() => {
                void cancelScheduledMessage(token, String(message.id)).then(
                  () => toast.success(t('timeline.sendCancelled')),
                  () => toast.error(t('timeline.cancelSendFailed')),
                )
              }}
              className="text-[10px] font-medium text-accent hover:underline"
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
      <div className="mb-1 truncate text-[10px] text-text-muted" title={message.cc}>
        {t('timeline.ccLine', { recipients: message.cc })}
      </div>
    ) : null
  const bubbleBodyWithMeta = ccLine ? (
    <div>
      {ccLine}
      {bubbleBody}
    </div>
  ) : (
    bubbleBody
  )

  const bubble = isInternal ? (
    <div className="border-l-2 border-border/70 py-0.5 pl-3">
      {header}
      <div className="text-xs leading-relaxed text-text-secondary">{bubbleBodyWithMeta}</div>
    </div>
  ) : useFullWidthEmailCard ? (
    <EmailMessageBlock avatar={contactAvatar} header={inboundHeader} body={bubbleBodyWithMeta} />
  ) : (
    <ChatMessageBubble side={side} avatar={avatar} header={header} body={bubbleBodyWithMeta} variant={variant} />
  )

  const inspectRow =
    displayBody && !sendFailed ? (
      <div
        className={cn(
          'mt-0.5 flex gap-0.5 opacity-0 pointer-events-none transition-opacity',
          'group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto',
          'focus-within:opacity-100 focus-within:pointer-events-auto',
          side === 'right' ? 'justify-end' : 'justify-start',
        )}
      >
        {displayBody && !sendFailed ? (
          <button
            type="button"
            aria-label={t('timeline.copyBody')}
            title={t('timeline.copyBody')}
            onClick={() => {
              void navigator.clipboard.writeText(displayBody).then(
                () => toast.success(t('timeline.bodyCopied')),
                () => toast.error(t('timeline.copyFailed')),
              )
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-accent"
          >
            <Text size={11} />
          </button>
        ) : null}
      </div>
    ) : null

  if (!message.agentTrace && !feedbackRow) {
    return (
      <div className="group/msg">
        {bubble}
        {inspectRow}
      </div>
    )
  }

  return (
    <div className={cn('group/msg flex flex-col space-y-0.5', isOwn ? 'items-end' : 'items-start')}>
      {message.agentTrace ? (
        <ReasoningDisclosure
          thinking={message.agentTrace.thinking}
          steps={message.agentTrace.steps}
          usage={message.agentTrace.usage}
          className={cn(isOwn ? 'ml-auto mr-9' : 'ml-9', 'max-w-[78%]')}
        />
      ) : null}
      {bubble}
      {inspectRow}
      {feedbackRow ? <div className={cn(isOwn ? 'mr-9' : 'ml-9')}>{feedbackRow}</div> : null}
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
  memberNameFor,
}: {
  events: InboxEvent[]
  memberNameFor: MemberNameResolver
}) {
  if (events.length === 0) return null
  if (events.length === 1) {
    return (
      <EventTimelineItem
        event={events[0]}
        memberName={memberNameFor(events[0].actorUserId)}
        memberNameFor={memberNameFor}
      />
    )
  }
  return (
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
}
