import { ChevronDown } from 'lucide-react'
import { Pressable } from '../ui/pressable'
import { Fragment, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { THREAD_GUTTER } from './ThreadMeta'

/**
 * Email on the timeline: "coloured envelope, white letter".
 *
 * Chat bubbles encode the author with a solid fill; an email is a document
 * with its own typography, signature and images, so its body always sits on
 * neutral paper. The author shows in the envelope band on top (accent for
 * you, AI tint for agents, neutral for everyone else) and in a tightened
 * top corner on the side the card hangs from — same grammar as chat bubbles.
 * Reply / reply-all / forward sit top-right on the envelope band; copy and
 * reactions stay at the bottom of the letter next to the time.
 */

export type MailCardTone = 'self' | 'agent' | 'team' | 'external'

export type EnvelopeRow = { key: string; label: string; value: string }

const CARD_TONE: Record<MailCardTone, string> = {
  self: 'ring-accent/30',
  agent: 'ring-border/55 shadow-[inset_2.5px_0_0_0_rgb(var(--color-ai)/0.72)]',
  team: 'ring-border/60',
  external: 'ring-border/60',
}

const BAND_TONE: Record<MailCardTone, string> = {
  self: 'bg-accent/[0.08]',
  agent: 'bg-bg-elevated',
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
  headerActions,
  actions,
  reactions,
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
  /** Time + delivery state, bottom-right of the letter. */
  meta?: ReactNode
  /** Reply / reply-all / forward — top-right on the envelope band. */
  headerActions?: ReactNode
  /** Copy / note actions — bottom-right, beside the time. */
  actions?: ReactNode
  /** WhatsApp-style reactions overlapping the bottom edge of the card. */
  reactions?: ReactNode
  /** Older mail folds to its band; click re-opens it. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  /** First line of the body for the folded state. */
  preview?: string
  expandAria?: string
}) {
  const isRight = side === 'right'
  const [envelopeOpen, setEnvelopeOpen] = useState(false)
  const canOpenEnvelope = envelopeRows.length > 0

  const bandButton = collapsed ? (
    <Pressable
      type="button"
      onClick={onToggleCollapsed}
      aria-expanded={false}
      aria-label={expandAria}
      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs leading-4"
    >
      <span className="shrink-0 font-semibold text-text-heading">{senderName}</span>
      {senderChip}
      {preview ? <span className="min-w-0 truncate text-text-muted">{preview}</span> : null}
    </Pressable>
  ) : (
    <div className="flex min-w-0 flex-1 flex-col">
      <Pressable
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
            size={14}
            aria-hidden
            className={cn(
              'shrink-0 text-text-muted transition-transform',
              envelopeOpen && 'rotate-180',
            )}
          />
        ) : null}
      </Pressable>
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
        'msg-bubble-enter flex items-start gap-2',
        isRight ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {isRight ? null : <span className={THREAD_GUTTER}>{avatar}</span>}
      {/* group/bubble on the card shell only — not the avatar column. */}
      <div
        className={cn(
          'group/bubble relative flex w-full min-w-0 max-w-[min(100%,42.5rem)] flex-col',
          isRight ? 'items-end' : 'items-start',
        )}
      >
      <div
        data-testid="mail-card"
        data-tone={tone}
        data-collapsed={collapsed || undefined}
        className={cn(
          // Same grammar as chat: round outer corners, tighten the corner that
          // faces the author so the card "hangs" from that side.
          'relative w-full min-w-0 overflow-hidden rounded-[14px] bg-bg-surface text-text-primary ring-1 ring-inset shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
          isRight ? 'rounded-tr-[4px]' : 'rounded-tl-[4px]',
          CARD_TONE[tone],
        )}
      >
        <div
          className={cn(
            'flex items-start gap-2 px-3.5 py-2',
            BAND_TONE[tone],
            !collapsed && 'border-b border-border',
          )}
        >
          {bandButton}
          <div className="flex shrink-0 items-center gap-1 self-start pt-0.5">
            {headerActions ? (
              <div
                className="flex items-center gap-px"
                onClick={(event) => event.stopPropagation()}
              >
                {headerActions}
              </div>
            ) : null}
            {collapsed && meta ? (
              <span className="flex items-center gap-1 text-2xs leading-4 tabular-nums text-text-muted">
                {meta}
              </span>
            ) : null}
          </div>
        </div>
        {collapsed ? null : (
          <div className="px-3.5 py-2.5 text-base leading-relaxed">
            {body}
            {actions || meta ? (
              <div className="mt-1.5 flex items-center justify-end gap-1.5 text-2xs leading-none tabular-nums text-text-muted">
                {actions ? (
                  <div
                    className="flex shrink-0 items-center gap-px"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {actions}
                  </div>
                ) : null}
                {meta ? <span className="flex shrink-0 items-center gap-1">{meta}</span> : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {reactions}
      </div>
    </div>
  )
}
