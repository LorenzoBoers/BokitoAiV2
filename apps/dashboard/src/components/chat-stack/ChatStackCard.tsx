import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AudioLines, PhoneOff, Pin, PinOff, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import type { StackCard } from '../../hooks/useChatStack'
import type { ChatStackAgent } from '../../lib/chat-stack'
import {
  requestAgentCallEnd,
  useAgentCallLive,
  useAgentCallSpeaking,
  useAgentCallUserSpeaking,
} from '../../lib/agent-call-live'
import { cn } from '../../lib/utils'
import { AiAvatar } from '../ui/AiAvatar'
import { Tooltip, TooltipContent, TooltipLabel, TooltipTrigger } from '../ui/tooltip'
import { AgentDoneCorner } from '../ui/AgentDoneCorner'
import { Button } from '../ui/button'

const FACE_SIZE = 32
/** Function keys Chrome and Bokito leave alone. Letters type, F5 reloads, F11 fills the screen. */
export const DIAL_KEYS = [
  { label: 'F1', key: 'F1', shift: false },
  { label: 'F2', key: 'F2', shift: false },
  { label: 'F4', key: 'F4', shift: false },
  { label: 'F8', key: 'F8', shift: false },
  { label: 'F9', key: 'F9', shift: false },
  { label: '⇧F2', key: 'F2', shift: true },
] as const

export function dialKeyIndex(event: KeyboardEvent): number {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return -1
  return DIAL_KEYS.findIndex((row) => event.key === row.key && event.shiftKey === row.shift)
}

const CARD_ACTION =
  'h-6 w-6 rounded-full border border-border/60 bg-bg-elevated text-text-muted shadow-sm hover:bg-bg-elevated hover:text-text-heading'

function DialChip({
  label,
  held,
  onHoldStart,
  onHoldEnd,
}: {
  label: string
  held: boolean
  onHoldStart: () => void
  onHoldEnd: () => void
}) {
  const { t } = useTranslation('communication')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'chat-stack-dial flex h-6 shrink-0 items-center gap-0.5 px-0.5 text-2xs',
            held ? 'text-accent' : 'text-text-secondary hover:text-text-heading',
          )}
          aria-label={t('agentCall.holdToSpeak')}
          aria-pressed={held}
          onPointerDown={(event) => {
            event.stopPropagation()
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            onHoldStart()
          }}
          onPointerUp={(event) => {
            event.stopPropagation()
            onHoldEnd()
          }}
          onPointerCancel={(event) => {
            event.stopPropagation()
            onHoldEnd()
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <AudioLines size={11} aria-hidden />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <TooltipLabel detail={label}>{t('agentCall.holdToSpeak')}</TooltipLabel>
      </TooltipContent>
    </Tooltip>
  )
}

function StackFace({
  agent,
  index,
  threadId,
  onDial,
  onDialEnd,
  dialHeld,
  dialLabel,
  raisedDial,
}: {
  agent: ChatStackAgent
  index: number
  threadId?: string
  onDial?: (threadId: string) => void
  onDialEnd?: () => void
  dialHeld?: boolean
  dialLabel?: string
  /** Left-hand chip sits above the faces. The others stay tucked under theirs. */
  raisedDial?: boolean
}) {
  const { t } = useTranslation('communication')
  const { user } = useAuth()
  const call = useAgentCallLive()
  const speaking = useAgentCallSpeaking()
  const userSpeaking = useAgentCallUserSpeaking()
  const wasWorking = useRef(agent.working)
  const [done, setDone] = useState(false)
  const [hot, setHot] = useState(false)
  const canDial = Boolean(threadId && onDial && onDialEnd && user?.agentCallsEnabled && dialLabel)
  const onCall =
    Boolean(threadId) &&
    call?.signalId === threadId &&
    call.agentId === agent.id &&
    (call.status === 'live' || call.status === 'connecting')
  const size = onCall ? 42 : FACE_SIZE
  useEffect(() => {
    if (wasWorking.current && !agent.working) setDone(true)
    if (agent.working) setDone(false)
    wasWorking.current = agent.working
  }, [agent.working])

  return (
    <span
      className="chat-stack-face relative inline-flex"
      data-working={!onCall && agent.working ? true : undefined}
      data-calling={onCall || undefined}
      style={{ animationDelay: `${index * 220}ms` }}
      title={agent.name}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
    >
      <span className="relative" style={{ zIndex: hot || onCall ? 30 : 20 - index }}>
      <AiAvatar
        size={size}
        name={agent.name}
        kind={agent.avatarKind ?? agent.kind}
        icon={agent.avatarIcon}
        color={agent.avatarColor}
        shape={agent.avatarShape}
        imageUrl={agent.avatarImageUrl}
        mode="live"
        motion={onCall ? (speaking ? 'talking' : userSpeaking ? 'listening' : 'idle') : agent.working ? 'working' : 'idle'}
        decorative
      />
      {done && !onCall ? <AgentDoneCorner size={size} enter /> : null}
      </span>
      {onCall ? (
        <button
          type="button"
          className="absolute right-full top-1/2 z-20 mr-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-status-error/40 bg-bg-elevated text-status-error shadow-overlay hover:bg-status-error/10"
          aria-label={t('agentCall.hangUp')}
          title={t('agentCall.hangUp')}
          onClick={(event) => {
            event.stopPropagation()
            requestAgentCallEnd()
          }}
        >
          <PhoneOff size={14} aria-hidden />
        </button>
      ) : null}
      {canDial && dialLabel && onDialEnd ? (
        <span
          className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1"
          style={{ zIndex: raisedDial ? 50 : 40 }}
        >
          <DialChip
            label={dialLabel}
            held={Boolean(dialHeld)}
            onHoldStart={() => onDial?.(threadId || '')}
            onHoldEnd={onDialEnd}
          />
        </span>
      ) : null}
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
  onDial?: (threadId: string) => void
  onDialEnd?: () => void
  dialHeld?: boolean
  dialLabels?: Record<string, string>
  onlyAgentId?: string
  /** Plain row in a list (mobile sheet): no stack transforms or hover actions. */
  inline?: boolean
  /** Collapsed, the stack draws one shared face row in front of every card. */
  showFaces?: boolean
}

/** Agent faces on the top edge, front agent rightmost. */
export function StackFaces({
  agents,
  className,
  threadId,
  onDial,
  onDialEnd,
  heldThreadId,
  dialLabels,
  onlyAgentId,
}: {
  agents: Array<ChatStackAgent & { threadId?: string }>
  className?: string
  threadId?: string
  onDial?: (threadId: string) => void
  onDialEnd?: () => void
  heldThreadId?: string | null
  dialLabels?: Record<string, string>
  onlyAgentId?: string
}) {
  const shown = onlyAgentId ? agents.filter((agent) => agent.id === onlyAgentId) : agents
  return (
    <span
      className={cn(
        'absolute -top-5 right-3 flex flex-row-reverse items-center gap-1.5',
        className,
      )}
    >
      {shown.map((agent, i) => (
        <StackFace
          key={agent.id}
          agent={agent}
          index={i}
          threadId={agent.threadId || threadId}
          onDial={onDial}
          onDialEnd={onDialEnd}
          dialHeld={Boolean(heldThreadId) && heldThreadId === (agent.threadId || threadId)}
          dialLabel={dialLabels?.[agent.id]}
          raisedDial={i === shown.length - 1 && shown.length > 1}
        />
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
  onDial,
  onDialEnd,
  dialHeld,
  dialLabels,
  onlyAgentId,
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
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
            : card.callPhase
              ? 'border-ai shadow-[0_0_28px_rgb(var(--color-ai)/0.35)]'
              : card.live
                ? 'border-ai/40'
                : 'border-border/70',
        )}
      >
        {showFaces && card.faces.length ? (
          <StackFaces
            agents={card.faces}
            threadId={card.id}
            onDial={inline ? undefined : onDial}
            onDialEnd={inline ? undefined : onDialEnd}
            heldThreadId={dialHeld ? card.id : null}
            dialLabels={inline ? undefined : dialLabels}
            onlyAgentId={onlyAgentId}
          />
        ) : null}

        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="chat-stack-title truncate-fade text-sm font-medium leading-snug text-text-heading">{title}</p>
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
