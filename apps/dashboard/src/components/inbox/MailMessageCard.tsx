import { ChevronDown } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { BubbleHoverToolbar } from './ChatBubble'

/**
 * Email on the timeline: "coloured envelope, white letter".
 *
 * Chat bubbles encode the author with a solid fill; an email is a document
 * with its own typography, signature and images, so its body always sits on
 * neutral paper. The author shows in the envelope band on top (accent for
 * you, AI tint for agents, neutral for everyone else) and in the side the
 * card hangs on — the same grammar the chat bubbles use.
 */

export type MailCardTone = 'self' | 'agent' | 'team' | 'external'

export type EnvelopeRow = { key: string; label: string; value: string }

const CARD_TONE: Record<MailCardTone, string> = {
  self: 'ring-accent/30',
  agent: 'ring-ai/25',
  team: 'ring-border/60',
  external: 'ring-border/60',
}

const BAND_TONE: Record<MailCardTone, string> = {
  self: 'bg-accent/[0.08]',
  agent: 'bg-ai/[0.07]',
  team: 'bg-bg-elevated',
  external: 'bg-bg-elevated',
}

export function MailMessageCard({
  side,
  tone,
  avatar,
  senderName,
  senderChip,
  summary,
  envelopeRows,
  envelopeAria,
  body,
  meta,
  actions,
  collapsed = false,
  onToggleCollapsed,
  preview,
  expandAria,
}: {
  side: 'left' | 'right'
  tone: MailCardTone
  /** Shown left of the card for other authors; your own cards carry none, like chat. */
  avatar?: ReactNode
  senderName: ReactNode
  senderChip?: ReactNode
  /** One-line recipient summary next to the name ("to you, +1"). */
  summary?: ReactNode
  /** Full envelope (From / To / CC / BCC) revealed under the summary. */
  envelopeRows: EnvelopeRow[]
  envelopeAria: string
  body: ReactNode
  /** Time + delivery state, right side of the band. */
  meta?: ReactNode
  /** Hover toolbar beside the card. */
  actions?: ReactNode
  /** Older mail folds to its band; click re-opens it. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  /** First line of the body for the folded state. */
  preview?: string
  expandAria?: string
}) {
  const isRight = side === 'right'
  const cardRef = useRef<HTMLDivElement>(null)
  const [envelopeOpen, setEnvelopeOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const hideTimer = useRef(0)
  const showActions = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = 0
    setActionsOpen(true)
  }, [])
  const hideActions = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setActionsOpen(false), 140)
  }, [])
  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    },
    [],
  )

  const hoverBind = actions && !collapsed ? { onMouseEnter: showActions, onMouseLeave: hideActions } : {}
  const canOpenEnvelope = envelopeRows.length > 0

  const bandButton = collapsed ? (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-expanded={false}
      aria-label={expandAria}
      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs leading-4"
    >
      <span className="shrink-0 font-semibold text-text-heading">{senderName}</span>
      {senderChip}
      {preview ? <span className="min-w-0 truncate text-text-muted">{preview}</span> : null}
    </button>
  ) : (
    <div className="flex min-w-0 flex-1 flex-col">
      <button
        type="button"
        onClick={canOpenEnvelope ? () => setEnvelopeOpen((v) => !v) : undefined}
        aria-expanded={envelopeOpen}
        aria-label={envelopeAria}
        disabled={!canOpenEnvelope}
        className="flex min-w-0 items-center gap-1.5 text-left text-xs leading-4 disabled:cursor-default"
      >
        <span className="shrink-0 font-semibold text-text-heading">{senderName}</span>
        {senderChip}
        {summary ? <span className="min-w-0 truncate text-text-muted">{summary}</span> : null}
        {canOpenEnvelope ? (
          <ChevronDown
            size={12}
            aria-hidden
            className={cn(
              'shrink-0 text-text-muted transition-transform',
              envelopeOpen && 'rotate-180',
            )}
          />
        ) : null}
      </button>
      {envelopeOpen ? (
        <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-2xs leading-snug text-text-secondary">
          {envelopeRows.map((row) => (
            <Fragment key={row.key}>
              <dt className="font-medium text-text-muted">{row.label}</dt>
              <dd className="min-w-0 break-all">{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  )

  return (
    <div
      className={cn(
        'msg-bubble-enter group/bubble flex items-start gap-2',
        isRight ? 'flex-row-reverse' : 'flex-row',
      )}
      {...hoverBind}
    >
      {isRight ? null : <span className="flex w-7 shrink-0 justify-center">{avatar}</span>}
      <div
        ref={cardRef}
        data-testid="mail-card"
        data-tone={tone}
        data-collapsed={collapsed || undefined}
        className={cn(
          'relative w-full min-w-0 max-w-[min(100%,42.5rem)] overflow-hidden rounded-[14px] bg-bg-surface text-text-primary ring-1 ring-inset shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
          CARD_TONE[tone],
        )}
      >
        <div
          className={cn(
            'flex items-start gap-2 px-3.5 py-2',
            BAND_TONE[tone],
            !collapsed && 'border-b border-border/50',
          )}
        >
          {bandButton}
          {meta ? (
            <span className="flex shrink-0 items-center gap-1 text-2xs leading-4 tabular-nums text-text-muted">
              {meta}
            </span>
          ) : null}
        </div>
        {collapsed ? null : (
          <div className="px-3.5 py-2.5 text-base leading-relaxed">{body}</div>
        )}
      </div>
      {actions && !collapsed ? (
        <BubbleHoverToolbar
          open={actionsOpen}
          anchorRef={cardRef}
          side={side}
          onEnter={showActions}
          onLeave={hideActions}
        >
          {actions}
        </BubbleHoverToolbar>
      ) : null}
    </div>
  )
}
