/**
 * Inline agent session marker: one centered pill in the timeline.
 *
 * The session's own messages are ordinary rows (see `session-timeline.ts`),
 * so this row only says where a session starts and, once it is closed, what
 * came out of it. Active: "{agent} · internal" with a quiet End / Cancel
 * action. Closed: a summary pill that expands in place to the transcript.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Loader2, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import {
  bokitoListMessages,
  closeAgentSession,
  discardAgentSession,
  type ThreadSession,
} from '../../lib/signals-api'
import type { InboxMessage } from '../../lib/inbox-api'
import { sessionTimelineMessages } from '../../lib/session-timeline'
import { assignBubbleStacks, type BubbleStack } from '../../lib/chat-layout'
import { translateMockAgentBody } from '../../lib/activity-labels'
import { AiMark } from '../ai/AiMark'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'
import { toast } from 'sonner'

type Props = {
  session: ThreadSession
  threadId: string
  /** True while the operator's message streams in this session. */
  streaming?: boolean
  /** Refetch the thread detail (session state changed). */
  onChanged: () => void
  /** Draw one transcript message with the shared bubble renderer. */
  renderMessage: (message: InboxMessage, stack: BubbleStack) => ReactNode
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

const PILL_CLASS =
  'inline-flex max-w-full items-center gap-1.5 rounded-lg bg-ai/[0.08] px-2.5 py-0.5 text-2xs leading-4 text-ai-ink'

function AgentNameLink({ session }: { session: ThreadSession }) {
  const { t } = useTranslation('communication')
  const name = session.agentName ?? t('agentSession.title')
  if (!session.agentId) return <span className="truncate font-medium">{name}</span>
  return (
    <Link
      to={`/agents/${session.agentId}`}
      className="truncate font-medium underline-offset-2 hover:underline"
    >
      {name}
    </Link>
  )
}

function InternalWord() {
  const { t } = useTranslation('communication')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-ai-ink/70">{t('agentSession.internalShort')}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{t('agentSession.internalHint')}</TooltipContent>
    </Tooltip>
  )
}

function ClosedTranscript({
  session,
  renderMessage,
}: {
  session: ThreadSession
  renderMessage: Props['renderMessage']
}) {
  const { t } = useTranslation('communication')
  const { token, user } = useAuth()
  const [messages, setMessages] = useState<InboxMessage[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    bokitoListMessages(token, session.id)
      .then((rows) => {
        if (cancelled) return
        setMessages(sessionTimelineMessages(session, rows, [], user?.id ?? null))
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [token, session, user?.id])

  const stacks = useMemo(
    () =>
      assignBubbleStacks(
        (messages ?? []).map((m) => ({
          id: String(m.id),
          key: m.kind === 'agent_message' ? 'agent' : `user:${m.authorUserId ?? 'me'}`,
          timeMs: new Date(m.createdAt).getTime(),
        })),
      ),
    [messages],
  )

  if (error) {
    return <p className="py-2 text-center text-xs text-status-error">{t('agentSession.transcriptError')}</p>
  }
  if (messages === null) {
    return (
      <div className="flex justify-center py-3 text-text-muted">
        <Loader2 size={14} className="animate-spin" />
      </div>
    )
  }
  if (messages.length === 0) {
    return <p className="py-2 text-center text-xs text-text-muted">{t('agentSession.emptyTranscript')}</p>
  }
  return (
    <div className="space-y-0.5 py-1">
      {messages.map((m) => {
        const stack = stacks.get(String(m.id)) ?? 'single'
        const tightBelow = stack === 'start' || stack === 'middle'
        return (
          <div key={String(m.id)} className={tightBelow ? 'mb-0.5' : 'mb-3'}>
            {renderMessage(m, stack)}
          </div>
        )
      })}
    </div>
  )
}

export default function SessionMarker({
  session,
  threadId,
  streaming = false,
  onChanged,
  renderMessage,
}: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [closing, setClosing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const started = session.messageCount > 0 || streaming

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
      <div className="flex justify-center py-0.5" data-testid="session-marker-active">
        <span className={PILL_CLASS}>
          <AiMark size={11} />
          <AgentNameLink session={session} />
          <span aria-hidden>·</span>
          <InternalWord />
          <span aria-hidden className="mx-0.5 h-3 w-px bg-ai-ink/20" />
          <button
            type="button"
            disabled={closing || streaming}
            onClick={() => void (started ? endSession() : cancelSession())}
            className="inline-flex items-center gap-1 text-ai-ink/70 hover:text-ai-ink disabled:opacity-50"
          >
            {closing ? <Loader2 size={10} className="animate-spin" /> : null}
            {closing
              ? t('agentSession.ending')
              : started
                ? t('agentSession.endSession')
                : t('agentSession.cancel')}
          </button>
        </span>
      </div>
    )
  }

  const summaryLine = [
    t('agentSession.messages', { count: session.messageCount }),
    session.actions.length > 0
      ? t('agentSession.actionsCount', { count: session.actions.length })
      : null,
    session.closedAt ? formatTime(session.closedAt) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div data-testid="session-marker-closed">
      <div className="flex justify-center py-0.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={cn(PILL_CLASS, 'hover:bg-ai/[0.14]')}
        >
          <AiMark size={11} />
          <span className="truncate">
            {t('agentSession.segmentClosed', {
              name: session.agentName ?? t('agentSession.title'),
            })}
          </span>
          <span aria-hidden>·</span>
          <span className="truncate text-ai-ink/70">{summaryLine}</span>
          {expanded ? (
            <ChevronDown size={12} className="shrink-0 text-ai-ink/70" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-ai-ink/70" />
          )}
        </button>
      </div>
      {expanded ? (
        <div className="mt-2 space-y-2">
          {session.summary ? (
            <p className="whitespace-pre-wrap break-words px-1 text-xs leading-relaxed text-text-secondary">
              {translateMockAgentBody(session.summary, t)}
            </p>
          ) : null}
          {session.actions.length > 0 ? (
            <ul className="space-y-1 px-1">
              {session.actions.map((action, idx) => (
                <li key={idx} className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <Wrench size={10} className="shrink-0 text-text-muted" />
                  <span className="truncate-fade font-mono">{actionLabel(action)}</span>
                  {action.at ? (
                    <span className="ml-auto shrink-0 text-2xs text-text-muted">
                      {formatTime(action.at)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <ClosedTranscript session={session} renderMessage={renderMessage} />
        </div>
      ) : null}
    </div>
  )
}
