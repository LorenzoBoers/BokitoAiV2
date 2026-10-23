/**
 * Inline agent session marker: one centered pill in the timeline.
 *
 * Session messages stay ordinary host-timeline rows (see `session-timeline.ts`
 * and ThreadDetail). This row only marks where a session starts and, once it
 * is closed, offers a compact summary of the outcome. Active: "{agent} ·
 * internal". Closed: a summary pill that expands to summary + actions.
 */
import { Pressable } from '../ui/pressable'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ThreadSession } from '../../lib/signals-api'
import { translateMockAgentBody } from '../../lib/activity-labels'
import { AiMark } from '../ai/AiMark'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'

type Props = {
  session: ThreadSession
  threadId: string
  /** True while the operator's message streams in this session. */
  streaming?: boolean
  /** Refetch the thread detail (session state changed). */
  onChanged: () => void
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
  'inline-flex w-auto max-w-full items-center gap-1.5 rounded-lg bg-ai/[0.08] px-2.5 py-0.5 text-2xs leading-4 text-ai-ink'

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

export default function SessionMarker({ session }: Props) {
  const { t } = useTranslation('communication')
  const [expanded, setExpanded] = useState(false)

  if (session.state === 'active') {
    return (
      <div className="flex justify-center py-0.5" data-testid="session-marker-active">
        <span className={PILL_CLASS}>
          <AiMark size={11} />
          <AgentNameLink session={session} />
          <span aria-hidden>·</span>
          <InternalWord />
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

  const hasDetails = Boolean(session.summary) || session.actions.length > 0

  return (
    <div data-testid="session-marker-closed">
      <div className="flex justify-center py-0.5">
        {hasDetails ? (
          <Pressable
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
              <ChevronDown size={14} className="shrink-0 text-ai-ink/70" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-ai-ink/70" />
            )}
          </Pressable>
        ) : (
          <span className={PILL_CLASS}>
            <AiMark size={11} />
            <span className="truncate">
              {t('agentSession.segmentClosed', {
                name: session.agentName ?? t('agentSession.title'),
              })}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate text-ai-ink/70">{summaryLine}</span>
          </span>
        )}
      </div>
      {expanded && hasDetails ? (
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
                  <Wrench size={14} className="shrink-0 text-text-muted" />
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
        </div>
      ) : null}
    </div>
  )
}
