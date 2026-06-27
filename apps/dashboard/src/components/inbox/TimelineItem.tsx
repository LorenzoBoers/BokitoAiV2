import { Mail, Phone, StickyNote, User } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { getDomainFaviconUrl } from '../../lib/domain-favicon'
import { getInitials, getAvatarColor } from '../../lib/avatar'
import { UserAvatar } from '../ui/UserAvatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import type { InboxEvent, InboxMessage, InboxMember, MessageAttachment } from '../../lib/inbox-api'
import MessageAttachments from './MessageAttachments'
import MessageMarkdown from './MessageMarkdown'

type MessageLayout = 'chat' | 'email'

type MessageItemProps = {
  message: InboxMessage
  layout?: MessageLayout
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  membersById?: Record<number, InboxMember>
}

type EventItemProps = {
  event: InboxEvent
  memberName?: string
}

export function formatHourMinute(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Hover popover with contact details (name, email, phone) shown next to the
// favicon. Renders only the rows that have data. Style mirrors the sidebar
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

// Domain favicon avatar with initials fallback on error. Wrapped in a hover
// tooltip showing name / email / phone (whatever is available).
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
  const [errored, setErrored] = useState(false)
  const faviconUrl = useMemo(() => getDomainFaviconUrl(email, 64), [email])
  const initials = getInitials(name || email || '?')
  const { bg, text } = getAvatarColor(email || name || '?')
  const borderRadius = Math.round(size * 0.3)

  const avatarNode =
    !faviconUrl || errored ? (
      <span
        style={{ width: size, height: size, borderRadius, background: bg, color: text, fontSize: Math.round(size * 0.36) }}
        className="inline-flex items-center justify-center font-semibold shrink-0 select-none cursor-default"
      >
        {initials}
      </span>
    ) : (
      <span
        style={{ width: size, height: size, borderRadius }}
        className="inline-flex items-center justify-center bg-bg border border-border/40 overflow-hidden shrink-0 cursor-default"
      >
        <img
          src={faviconUrl}
          alt={name || email}
          onError={() => setErrored(true)}
          width={Math.round(size * 0.7)}
          height={Math.round(size * 0.7)}
          className="object-contain"
        />
      </span>
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
  if (/<(?:table|style|link|script|iframe|object|embed|form|meta)\b/i.test(trimmed)) return false
  if (/\bbackground(?:-color)?\s*:/i.test(trimmed)) return false
  return true
}

function SimpleMessageHtml({ html }: { html: string }) {
  return (
    <div
      className="text-xs text-text-primary leading-relaxed break-words [&_img]:mt-4 [&_img]:block [&_img]:max-w-[260px] [&_img]:h-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// Renders email HTML inside a sandboxed iframe so the email's <style> tags,
// link colors and other global rules do not bleed into the host app.
function EmailHtmlFrame({ html, isDark }: { html: string; isDark: boolean }) {
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

  const handleLoad = useCallback(() => {
    measure()
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
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
  }, [measure])

  useEffect(() => {
    const id = window.setTimeout(measure, 250)
    return () => window.clearTimeout(id)
  }, [measure, html])

  const textColor = isDark ? '#e2e8f0' : '#1f2937'
  const linkColor = isDark ? '#60a5fa' : '#2563eb'
  const darkBgReset = isDark
    ? `body, div, p, span, td, th, table, tbody, thead, tr {
  background-color: transparent !important;
  background-image: none !important;
}`
    : ''

  const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
html, body { margin: 0; padding: 0; background: transparent !important; color: ${textColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.5; word-break: break-word; }
body { padding: 2px 0; }
img { max-width: 100%; height: auto; }
table { max-width: 100% !important; }
a { color: ${linkColor}; }
${darkBgReset}
</style></head><body>${html}</body></html>`

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={wrappedHtml}
      onLoad={handleLoad}
      title="Email content"
      className="block w-full bg-transparent"
      style={{
        height: `${height}px`,
        border: 0,
        background: 'transparent',
        colorScheme: isDark ? 'dark' : 'light',
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

const EVENT_LABELS: Record<string, (payload: Record<string, unknown>, memberName?: string) => string> = {
  thread_created: () => 'Thread aangemaakt',
  assigned: (p, name) => `Toegewezen aan ${name ?? `gebruiker ${p.assignee_id}`}`,
  unassigned: () => 'Toewijzing verwijderd',
  status_changed: (p) => `Status gewijzigd naar ${p.to_status ?? ''}`,
  tag_added: (p) => `Label toegevoegd: ${Array.isArray(p.tags) ? p.tags.join(', ') : ''}`,
  tag_removed: () => 'Label verwijderd',
  priority_changed: (p) => `Prioriteit: ${p.priority ?? ''}`,
  replied: () => 'Antwoord verstuurd',
  note_added: () => 'Notitie toegevoegd',
  reopened: () => 'Heropend',
}

// Chat-style bubble: avatar on one side, message bubble constrained to a
// portion of the width so left/right alignment is clearly visible.
function ChatMessageBubble({
  side,
  avatar,
  header,
  body,
  internal,
}: {
  side: 'left' | 'right'
  avatar: ReactNode
  header: ReactNode
  body: ReactNode
  internal?: boolean
}) {
  const isRight = side === 'right'
  return (
    <div className={cn('flex items-end gap-2', isRight ? 'justify-end' : 'justify-start')}>
      {isRight ? null : avatar}
      <div
        className={cn(
          'max-w-[78%] min-w-0 rounded-2xl border px-3 py-2',
          isRight ? 'rounded-br-sm' : 'rounded-bl-sm',
          internal
            ? 'bg-yellow-50 border-yellow-200/60 dark:bg-yellow-900/10 dark:border-yellow-700/30'
            : isRight
              ? 'bg-bg-surface border-border/50 ring-1 ring-accent/10 dark:ring-accent/15'
              : 'bg-bg-surface border-border/50',
        )}
      >
        {header}
        {body}
      </div>
      {isRight ? avatar : null}
    </div>
  )
}

// Email-style block: full width, left-aligned, flat card (no chat bubble
// corners) regardless of direction.
function EmailMessageBlock({
  avatar,
  header,
  body,
  internal,
}: {
  avatar: ReactNode
  header: ReactNode
  body: ReactNode
  internal?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      {avatar}
      <div
        className={cn(
          'w-full min-w-0 rounded-lg border px-3 py-2',
          internal
            ? 'bg-yellow-50 border-yellow-200/60 dark:bg-yellow-900/10 dark:border-yellow-700/30'
            : 'bg-bg-surface border-border/50',
        )}
      >
        {header}
        {body}
      </div>
    </div>
  )
}

export function MessageTimelineItem({ message, layout = 'chat', contactName, contactEmail, contactPhone, membersById }: MessageItemProps) {
  const { user } = useAuth()
  const currentUserId = user?.id ?? null
  const isInternal = message.direction === 'internal'
  const isOutbound = message.direction === 'outbound'
  const isInbound = !isInternal && !isOutbound

  // Resolve author info for outbound / internal bubbles
  const author = message.authorUserId != null ? membersById?.[message.authorUserId] : undefined
  const authorName = author?.name ?? (isOutbound ? 'Jij' : 'Teamlid')
  const authorEmail = author?.email ?? ''
  const authorAvatarUrl = author?.avatarUrl ?? null

  // Inbound contact info: prefer thread contact, fallback to message fromAddress
  const inboundEmail = message.fromAddress || contactEmail || ''
  const inboundName = contactName || inboundEmail || 'Afzender'

  const attachmentItems: MessageAttachment[] = Array.isArray(message.attachments)
    ? message.attachments.filter(
        (a): a is MessageAttachment =>
          !!a &&
          typeof a === 'object' &&
          typeof (a as MessageAttachment).id === 'string' &&
          typeof (a as MessageAttachment).url === 'string',
      )
    : []

  const bubbleBody = message.bodyHtml ? (
    <MessageHtmlBody html={message.bodyHtml} />
  ) : (
    <div className="space-y-1">
      <MessageMarkdown text={message.bodyPreview || message.bodyText || ''} />
      <MessageAttachments attachments={attachmentItems} />
    </div>
  )

  const contactAvatar = (
    <ContactAvatar email={inboundEmail} name={inboundName} phone={contactPhone} size={28} />
  )
  const userAvatar = (
    <UserAvatar name={authorName} email={authorEmail || authorName} avatarUrl={authorAvatarUrl} size={28} />
  )

  const inboundHeader = (
    <div className="flex items-baseline gap-1.5 mb-1 min-w-0">
      <span className="font-medium text-text-heading text-xs truncate">{inboundName}</span>
      {inboundEmail && inboundEmail !== inboundName ? (
        <span className="text-[10px] text-text-muted truncate">{inboundEmail}</span>
      ) : null}
    </div>
  )
  const outboundHeader = (
    <div className="flex items-center gap-1.5 mb-1 min-w-0">
      {isInternal ? <StickyNote size={12} className="text-yellow-600 shrink-0" /> : null}
      <span className="font-medium text-text-heading text-xs truncate">{authorName}</span>
      <span className="text-[10px] text-text-muted shrink-0">
        {isInternal ? 'Interne notitie' : 'Verstuurd'}
      </span>
    </div>
  )

  // Email threads: never use chat-style left/right alignment. Render every
  // message as a full-width, left-aligned card.
  if (layout === 'email') {
    return (
      <EmailMessageBlock
        avatar={isInbound ? contactAvatar : userAvatar}
        header={isInbound ? inboundHeader : outboundHeader}
        body={bubbleBody}
        internal={isInternal}
      />
    )
  }

  // Chat layout. Inbound messages go left with the contact avatar.
  if (isInbound) {
    return (
      <ChatMessageBubble side="left" avatar={contactAvatar} header={inboundHeader} body={bubbleBody} />
    )
  }

  // Outbound / internal: only the logged-in user's own messages align right.
  // Messages sent by a colleague stay left, labelled with their name.
  const isOwn =
    message.authorUserId != null &&
    currentUserId != null &&
    message.authorUserId === currentUserId

  return (
    <ChatMessageBubble
      side={isOwn ? 'right' : 'left'}
      avatar={userAvatar}
      header={outboundHeader}
      body={bubbleBody}
      internal={isInternal}
    />
  )
}

export function EventTimelineItem({ event, memberName }: EventItemProps) {
  const labelFn = EVENT_LABELS[event.eventType]
  const label = labelFn ? labelFn(event.payload, memberName) : event.eventType

  return (
    <div className="flex items-center gap-2 py-1 px-2">
      <div className="h-px flex-1 bg-border/40" />
      <span className="text-xs text-text-muted whitespace-nowrap">{label}</span>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  )
}
