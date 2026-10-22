import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin, PinOff, X } from 'lucide-react'
import type { StackCard } from '../../hooks/useChatStack'
import type { ChatStackAgent } from '../../lib/chat-stack'
import { cn } from '../../lib/utils'
import { AiAvatar } from '../ui/AiAvatar'
import { AgentDoneCorner } from '../ui/AgentDoneCorner'
import { Button } from '../ui/button'

const FACE_SIZE = 32
const CARD_ACTION =
  'h-6 w-6 rounded-full border border-border/60 bg-bg-elevated text-text-muted shadow-sm hover:bg-bg-elevated hover:text-text-heading'

function StackFace({ agent, index }: { agent: ChatStackAgent; index: number }) {
  const wasWorking = useRef(agent.working)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (wasWorking.current && !agent.working) setDone(true)
    if (agent.working) setDone(false)
    wasWorking.current = agent.working
  }, [agent.working])

  return (
    <span
      className="chat-stack-face relative inline-flex"
      data-working={agent.working || undefined}
      style={{ zIndex: 20 - index, animationDelay: `${index * 220}ms` }}
      title={agent.name}
    >
      <AiAvatar
        size={FACE_SIZE}
        name={agent.name}
        kind={agent.avatarKind ?? agent.kind}
        icon={agent.avatarIcon}
        color={agent.avatarColor}
        shape={agent.avatarShape}
        imageUrl={agent.avatarImageUrl}
        mode="live"
        motion={agent.working ? 'working' : 'idle'}
        decorative
      />
      {done ? <AgentDoneCorner size={FACE_SIZE} enter /> : null}
    </span>
  )
}

export type ChatStackCardProps = {
  card: StackCard
  /** Position from the front (0 = front card). */
  index: number
  expanded: boolean
  /** Card is beyond what the collapsed or fanned stack shows. */
  hidden: boolean
  width: number
  nudge: boolean
  onOpen: (card: StackCard, el: HTMLElement) => void
  onTogglePin: (card: StackCard) => void
  onDismiss: (card: StackCard) => void
  /** Plain row in a list (mobile sheet): no stack transforms or hover actions. */
  inline?: boolean
  /** Collapsed, the stack draws one shared face row in front of every card. */
  showFaces?: boolean
}

/** Agent faces overlapping on the top edge, front agent rightmost. */
export function StackFaces({ agents, className }: { agents: ChatStackAgent[]; className?: string }) {
  return (
    <span
      className={cn(
        'absolute -top-5 right-3 flex flex-row-reverse items-center -space-x-2.5 space-x-reverse',
        className,
      )}
    >
      {agents.map((agent, i) => (
        <StackFace key={agent.id} agent={agent} index={i} />
      ))}
    </span>
  )
}

export function ChatStackCard({
  card,
  index,
  expanded,
  hidden,
  width,
  nudge,
  onOpen,
  onTogglePin,
  onDismiss,
  inline = false,
  showFaces = true,
}: ChatStackCardProps) {
  const { t } = useTranslation('communication')
  const bodyRef = useRef<HTMLDivElement>(null)
  const title = card.title || t('chatStack.untitled')
  const author =
    card.previewBy === 'team' ? t('chatStack.you') : card.previewAuthor
  const preview = card.preview ? (author ? `${author}: ${card.preview}` : card.preview) : ''
  const callLine =
    card.callPhase === 'ringing'
      ? t('chatStack.callRinging', {
          name: card.liveAgentName || t('agentCall.agent'),
        })
      : card.callPhase === 'connecting' || card.callPhase === 'live'
        ? t('chatStack.callLive', {
            name: card.liveAgentName || t('agentCall.agent'),
          })
        : null
  const liveLine =
    callLine ??
    (card.live
      ? [
          card.liveAgentName
            ? t('chatStack.working', { name: card.liveAgentName })
            : t('chatStack.workingFallback'),
          card.liveSummary,
        ]
          .filter(Boolean)
          .join(' · ')
      : null)

  const gap = 10
  const transform = expanded
    ? `translateX(${-index * (width + gap)}px)`
    : `translateX(${index * 6}px) translateY(${-index * 7}px) scale(${1 - index * 0.04})`
  const style: CSSProperties = inline
    ? {}
    : {
        width,
        transform,
        zIndex: 50 - index,
        opacity: hidden ? 0 : 1,
        ['--stack-delay' as string]: `${(expanded ? index : 0) * 30}ms`,
      }

  const open = () => {
    if (bodyRef.current) onOpen(card, bodyRef.current)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }

  return (
    <div
      className={inline ? 'relative' : 'chat-stack-card absolute bottom-0 right-0 origin-bottom-right'}
      style={style}
      data-hidden={hidden || undefined}
      aria-hidden={hidden || undefined}
      data-stack-card-id={inline ? undefined : card.id}
    >
      <div
        ref={bodyRef}
        role={inline ? undefined : 'button'}
        tabIndex={inline || hidden ? -1 : 0}
        aria-label={inline ? undefined : t('chatStack.open', { title })}
        onClick={inline ? undefined : open}
        onKeyDown={inline ? undefined : onKeyDown}
        data-nudge={nudge || undefined}
        className={cn(
          'chat-stack-card-body group/card relative cursor-pointer rounded-lg border bg-bg-elevated px-3 pb-2.5 pt-4 shadow-overlay',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          card.callPhase === 'ringing'
            ? 'border-accent/50'
            : card.live || card.callPhase
              ? 'border-ai/40'
              : 'border-border/70',
        )}
      >
        {showFaces && card.faces.length ? <StackFaces agents={card.faces} /> : null}

        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate-fade pr-16 text-sm font-medium leading-snug text-text-heading">{title}</p>
            {liveLine ? (
              <p className="chat-stack-shimmer mt-0.5 truncate-fade text-xs leading-snug">{liveLine}</p>
            ) : preview ? (
              <p className="mt-0.5 truncate-fade text-xs leading-snug text-text-muted">{preview}</p>
            ) : null}
          </div>
          {card.unread ? (
            <span
              className="chat-stack-unread mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent"
              aria-hidden
            />
          ) : null}
        </div>

        {expanded && !hidden && !inline ? (
          <div className="absolute -left-2 -top-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-within/card:opacity-100">
            <Button
              type="button"
              variant="secondary"
              size="iconSm"
              className={CARD_ACTION}
              aria-label={card.pinned ? t('chatStack.unpin') : t('chatStack.pin')}
              title={card.pinned ? t('chatStack.unpin') : t('chatStack.pin')}
              onClick={(event) => {
                event.stopPropagation()
                onTogglePin(card)
              }}
            >
              {card.pinned ? <PinOff size={11} aria-hidden /> : <Pin size={11} aria-hidden />}
            </Button>
            {!card.pinned ? (
              <Button
                type="button"
                variant="secondary"
                size="iconSm"
                className={CARD_ACTION}
                aria-label={t('chatStack.dismiss')}
                title={t('chatStack.dismiss')}
                onClick={(event) => {
                  event.stopPropagation()
                  onDismiss(card)
                }}
              >
                <X size={11} aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
