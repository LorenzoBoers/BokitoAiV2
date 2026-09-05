import { useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, Wrench, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import ChatMarkdown from './ChatMarkdown'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import {
  bokitoListMessages,
  closeAgentSession,
  discardAgentSession,
  type ChatMessage,
  type ThreadSession,
} from '../../lib/signals-api'
import { translateMockAgentBody } from '../../lib/activity-labels'
import { Button } from '../ui/button'
import { AiIconBox, AiMark } from '../ai/AiMark'
import { BubbleHeader, ChatMessageBubble } from './ChatBubble'
import { UserAvatar } from '../ui/UserAvatar'
import { cn } from '../../lib/utils'
import { toast } from 'sonner'

type Props = {
  session: ThreadSession
  threadId: string
  /** Refetch the thread detail (session state changed). */
  onChanged: () => void
  /** Put an agent answer into the reply composer. */
  onUseAsReply?: (text: string) => void
  /** Live messages already merged by the parent (active session). */
  liveMessages?: ChatMessage[]
  /** True while the operator's message is streaming a reply. */
  streaming?: boolean
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Human label for a consequential tool call in the checkout summary. */
function actionLabel(action: ThreadSession['actions'][number]): string {
  if (action.tool === 'call_mcp_tool' && action.detail) return action.detail
  if (action.detail) return `${action.tool}: ${action.detail}`
  return action.tool
}

function MetaBubble({
  message,
  agentName,
  operatorAvatar,
  onUseAsReply,
}: {
  message: ChatMessage
  agentName?: string | null
  operatorAvatar: ReactNode
  onUseAsReply?: (text: string) => void
}) {
  const { t } = useTranslation('communication')
  const isUser = message.role === 'user'
  if (isUser) {
    return (
      <ChatMessageBubble
        side="right"
        avatar={operatorAvatar}
        variant="self"
        body={<p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{message.content}</p>}
      />
    )
  }
  return (
    <ChatMessageBubble
      side="left"
      avatar={<AiIconBox size="sm" />}
      variant="agent"
      header={
        <BubbleHeader name={agentName || t('agentSession.title')} />
      }
      body={
        <div className="text-[13px] leading-relaxed">
          <ChatMarkdown content={translateMockAgentBody(message.content, t)} />
          {onUseAsReply && message.content.trim() && message.id !== 'local-stream' ? (
            <button
              type="button"
              onClick={() => onUseAsReply(message.content)}
              className="mt-1.5 text-[11px] font-medium text-ai-ink/80 hover:text-ai-ink"
            >
              {t('agentSession.useAsReply')}
            </button>
          ) : null}
        </div>
      }
    />
  )
}

function SessionTranscript({
  sessionId,
  agentName,
  messages: controlled,
  operatorAvatar,
  onUseAsReply,
  streaming,
}: {
  sessionId: string
  agentName?: string | null
  messages?: ChatMessage[]
  operatorAvatar: ReactNode
  onUseAsReply?: (text: string) => void
  streaming?: boolean
}) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[] | null>(controlled ?? null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (controlled) {
      setMessages(controlled)
      return
    }
    if (!token) return
    let cancelled = false
    bokitoListMessages(token, sessionId)
      .then((rows) => {
        if (!cancelled) setMessages(rows.filter((m) => m.role === 'user' || m.role === 'assistant'))
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [token, sessionId, controlled])

  if (error) {
    return <p className="px-1 py-2 text-[12px] text-status-error">{t('agentSession.transcriptError')}</p>
  }
  if (messages === null) {
    return (
      <div className="flex justify-center py-3 text-text-muted">
        <Loader2 size={14} className="animate-spin" />
      </div>
    )
  }
  if (messages.length === 0 && !streaming) {
    return (
      <p className="px-1 py-2 text-[12px] text-text-muted">{t('agentSession.emptyTranscript')}</p>
    )
  }
  return (
    <div className="space-y-2.5 py-1">
      {messages.map((m) => (
        <MetaBubble
          key={m.id}
          message={m}
          agentName={agentName}
          operatorAvatar={operatorAvatar}
          onUseAsReply={onUseAsReply}
        />
      ))}
      {streaming && !messages.some((m) => m.id === 'local-stream') ? (
        <div className="flex items-center gap-2 px-1 py-1 text-[12px] text-text-muted">
          <Loader2 size={12} className="animate-spin text-ai" />
          {t('agentSession.thinking', { defaultValue: 'Thinking…' })}
        </div>
      ) : null}
    </div>
  )
}

function SessionToolbar({
  session,
  started,
  closing,
  onEnd,
  onCancel,
}: {
  session: ThreadSession
  started: boolean
  closing: boolean
  onEnd: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('communication')
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-ai/25 bg-ai/10 px-2 py-0.5 text-[11px] font-medium text-ai-ink">
        <AiMark size={11} />
        {t('agentSession.segmentActive', {
          name: session.agentName ?? t('agentSession.title'),
        })}
      </span>
      <span className="text-[10.5px] text-text-muted">{t('agentSession.internalHint')}</span>
      <div className="ml-auto flex items-center gap-1">
        {session.agentId ? (
          <Link
            to={`/agents/${session.agentId}`}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-text-muted hover:bg-bg-hover hover:text-text-primary"
          >
            <ExternalLink size={11} />
            {t('agentSession.openAgent')}
          </Link>
        ) : null}
        {started ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={closing}
            onClick={onEnd}
            className="h-7 gap-1.5 px-2.5 text-[11.5px]"
          >
            {closing ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            {closing ? t('agentSession.ending') : t('agentSession.endSession')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={closing}
            onClick={onCancel}
            className="h-7 gap-1.5 px-2.5 text-[11.5px] text-text-muted"
          >
            {closing ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
            {t('agentSession.cancel')}
          </Button>
        )}
      </div>
    </div>
  )
}

function ExpandedExtras({ session }: { session: ThreadSession }) {
  const { t } = useTranslation('communication')
  return (
    <div className="space-y-2 py-1">
      {session.summary ? (
        <p className="whitespace-pre-wrap break-words px-1 text-[12px] leading-relaxed text-text-secondary">
          {translateMockAgentBody(session.summary, t)}
        </p>
      ) : null}
      <div className="px-1">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          {t('agentSession.actionsTitle')}
        </p>
        {session.actions.length === 0 ? (
          <p className="text-[11.5px] text-text-muted">{t('agentSession.noActions')}</p>
        ) : (
          <ul className="space-y-1">
            {session.actions.map((action, idx) => (
              <li key={idx} className="flex items-center gap-1.5 text-[11.5px] text-text-secondary">
                <Wrench size={10} className="shrink-0 text-text-muted" />
                <span className="truncate font-mono">{actionLabel(action)}</span>
                {action.at ? (
                  <span className="ml-auto shrink-0 text-[10px] text-text-muted">
                    {formatTime(action.at)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * Inline agent meta segment in the host timeline.
 * Active: normal left/right bubbles (no parent plane). Closed: one shared
 * summary bubble that expands in place to the same transcript style.
 */
export default function AgentSessionCard({
  session,
  threadId,
  onChanged,
  onUseAsReply,
  liveMessages,
  streaming,
}: Props) {
  const { t } = useTranslation('communication')
  const { token, user } = useAuth()
  const [closing, setClosing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const started = session.messageCount > 0 || (liveMessages?.length ?? 0) > 0

  const operatorName = user?.name?.trim() || user?.email || t('timeline.events.you')
  const operatorEmail = user?.email || operatorName
  const operatorAvatar = (
    <UserAvatar
      name={operatorName}
      email={operatorEmail}
      avatarUrl={user?.avatarUrl}
      size={28}
      decorative
    />
  )
  const agentAvatar = <AiIconBox size="sm" />

  const endSession = async () => {
    if (!token || closing) return
    setClosing(true)
    try {
      await closeAgentSession(token, threadId, session.id)
      toast.success(t('agentSession.closedToast'))
      onChanged()
    } catch {
      toast.error(t('agentSession.closeError'))
    } finally {
      setClosing(false)
    }
  }

  const cancelSession = async () => {
    if (!token || closing) return
    setClosing(true)
    try {
      await discardAgentSession(token, threadId, session.id)
      onChanged()
    } catch {
      toast.error(t('agentSession.cancelError'))
    } finally {
      setClosing(false)
    }
  }

  if (session.state === 'active') {
    return (
      <div className="my-2">
        <SessionToolbar
          session={session}
          started={started}
          closing={closing}
          onEnd={() => void endSession()}
          onCancel={() => void cancelSession()}
        />
        <SessionTranscript
          sessionId={session.id}
          agentName={session.agentName}
          messages={liveMessages}
          operatorAvatar={operatorAvatar}
          onUseAsReply={onUseAsReply}
          streaming={streaming}
        />
      </div>
    )
  }

  const summaryLine = [
    t('agentSession.messages', { count: session.messageCount }),
    session.actions.length > 0
      ? t('agentSession.actionsCount', { count: session.actions.length })
      : null,
    session.closedAt ? t('agentSession.closedAt', { time: formatTime(session.closedAt) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="my-2 space-y-2">
      <ChatMessageBubble
        side="left"
        avatar={agentAvatar}
        endAvatar={operatorAvatar}
        variant="agent"
        onClick={() => setExpanded((v) => !v)}
        className="w-full"
        header={
          <BubbleHeader
            name={t('agentSession.segmentClosed', {
              name: session.agentName ?? t('agentSession.title'),
            })}
            subtitle={t('agentSession.internalHint')}
            trailing={
              expanded ? (
                <ChevronDown size={14} className="ml-auto shrink-0 text-text-muted" />
              ) : (
                <ChevronRight size={14} className="ml-auto shrink-0 text-text-muted" />
              )
            }
          />
        }
        body={
          <div className="min-w-0">
            <p className="truncate text-[11px] text-text-muted">{summaryLine}</p>
            {session.summary && !expanded ? (
              <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-text-secondary">
                {translateMockAgentBody(session.summary, t)}
              </p>
            ) : null}
          </div>
        }
      />

      {expanded ? (
        <div className={cn('space-y-1')}>
          <ExpandedExtras session={session} />
          <SessionTranscript
            sessionId={session.id}
            agentName={session.agentName}
            operatorAvatar={operatorAvatar}
          />
        </div>
      ) : null}
    </div>
  )
}
