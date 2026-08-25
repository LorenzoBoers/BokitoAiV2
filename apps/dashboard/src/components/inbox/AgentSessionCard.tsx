import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, ChevronDown, ChevronRight, Loader2, Wrench } from 'lucide-react'
import ChatMarkdown from './ChatMarkdown'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { closeAgentSession, type ThreadSession } from '../../lib/signals-api'
import { bokitoListMessages, type ChatMessage } from '../../lib/bokito-api'
import { translateMockAgentBody } from '../../lib/activity-labels'
import DirectChatPanel from './DirectChatPanel'
import { Button } from '../ui/button'
import { toast } from 'sonner'

type Props = {
  session: ThreadSession
  threadId: string
  /** Refetch the thread detail (session state changed). */
  onChanged: () => void
  /** Put an agent answer into the reply composer. */
  onUseAsReply?: (text: string) => void
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

function ReadOnlyTranscript({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
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
  }, [token, sessionId])

  if (error) {
    return <p className="px-3 py-2 text-[12px] text-status-error">{t('agentSession.transcriptError')}</p>
  }
  if (messages === null) {
    return (
      <div className="flex justify-center py-4 text-text-muted">
        <Loader2 size={14} className="animate-spin" />
      </div>
    )
  }
  return (
    <div className="max-h-[320px] space-y-2.5 overflow-y-auto px-3 py-2.5">
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[82%] rounded-xl rounded-tr-sm bg-accent/12 px-3 py-1.5 text-[12.5px] leading-relaxed text-text-primary">
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-ai/25 bg-ai/10 text-ai-ink">
              <Bot size={11} />
            </span>
            <div className="max-w-[82%] rounded-xl rounded-tl-sm border border-ai/20 bg-ai/[0.06] px-3 py-1.5 text-[12.5px] leading-relaxed text-text-primary">
              <ChatMarkdown content={translateMockAgentBody(m.content, t)} />
            </div>
          </div>
        ),
      )}
    </div>
  )
}

/**
 * Inline agent session block in the thread timeline.
 *
 * Active: a live chat with the chosen agent, grounded in the host thread,
 * with an explicit "End session" checkout. Closed: a collapsed summary row
 * (what was concluded + which actions ran) that expands to the full
 * transcript for review.
 */
export default function AgentSessionCard({ session, threadId, onChanged, onUseAsReply }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [closing, setClosing] = useState(false)
  const [expanded, setExpanded] = useState(false)

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

  if (session.state === 'active') {
    return (
      <div className="overflow-hidden rounded-xl border border-ai/30 bg-bg-surface shadow-card">
        <div className="flex items-center gap-2 border-b border-ai/20 bg-ai/6 px-3 py-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-ai/30 bg-ai/10 text-ai-ink">
            <Bot size={13} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[12.5px] font-medium text-text-primary">
              {session.agentName ?? t('agentSession.title')}
              <span className="ml-2 rounded-full bg-ai/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ai-ink">
                {t('agentSession.activeBadge')}
              </span>
            </p>
            <p className="truncate text-[10.5px] text-text-muted">{t('agentSession.internalHint')}</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={closing}
            onClick={() => void endSession()}
            className="h-7 gap-1.5 px-2.5 text-[11.5px]"
          >
            {closing ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            {closing ? t('agentSession.ending') : t('agentSession.endSession')}
          </Button>
        </div>
        <div className="h-[420px]">
          <DirectChatPanel
            conversationId={session.id}
            hideHeader
            onCopyText={onUseAsReply}
            copyLabel={t('agentSession.useAsReply')}
            composerPlaceholder={t('agentSession.composerPlaceholder')}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-bg-elevated">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-hover/40"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-bg-elevated text-text-muted">
          <Bot size={13} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[12.5px] font-medium text-text-primary">
            {session.agentName ?? t('agentSession.title')}
            <span className="ml-2 text-[10.5px] font-normal text-text-muted">
              {session.closedAt
                ? t('agentSession.closedAt', { time: formatTime(session.closedAt) })
                : null}
            </span>
          </p>
          <p className="truncate text-[11px] text-text-muted">
            {t('agentSession.messages', { count: session.messageCount })}
            {session.actions.length > 0
              ? ` · ${t('agentSession.actionsCount', { count: session.actions.length })}`
              : ''}
          </p>
        </div>
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-text-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-text-muted" />
        )}
      </button>

      {session.summary && !expanded ? (
        <p className="line-clamp-2 border-t border-border/40 px-3 py-2 text-[12px] leading-relaxed text-text-secondary">
          {translateMockAgentBody(session.summary, t)}
        </p>
      ) : null}

      {expanded ? (
        <div className="border-t border-border/40">
          {session.summary ? (
            <p className="whitespace-pre-wrap break-words border-b border-border/40 px-3 py-2 text-[12px] leading-relaxed text-text-secondary">
              {translateMockAgentBody(session.summary, t)}
            </p>
          ) : null}
          <div className="border-b border-border/40 px-3 py-2">
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
          <ReadOnlyTranscript sessionId={session.id} />
        </div>
      ) : null}
    </div>
  )
}
