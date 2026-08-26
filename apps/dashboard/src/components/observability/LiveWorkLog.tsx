import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  fetchWorkLogEvents,
  type WorkLogEvent,
  type WorkLogStatus,
} from '../../lib/work-logs-api'
import { fetchRunEvents } from '../../lib/orchestration-api'
import { onGatewayEvent } from '../../lib/gateway'
import {
  activityEventMessage,
  activityEventTypeLabel,
  isCockpitHeadlineEvent,
} from '../../lib/activity-labels'
import { formatWorkLogSubject } from '../../lib/work-log-labels'
import { humanizeModelId } from '../../lib/model-label'
import { workLogStatusLabel } from '../../lib/status-labels'
import { agentRunsPath } from '../../lib/messages-paths'

type Props = {
  workLogId: string
}

export function LiveWorkLog({ workLogId }: Props) {
  const { t } = useTranslation(['nav', 'communication'])
  const [events, setEvents] = useState<WorkLogEvent[]>([])
  const [status, setStatus] = useState<WorkLogStatus | null>(null)
  const [taskSubject, setTaskSubject] = useState<string | null>(null)
  const [tokensUsed, setTokensUsed] = useState<number | null>(null)
  const [runtimeModel, setRuntimeModel] = useState<string | null>(null)
  const [contextPct, setContextPct] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const applyOrchestrationEvent = (ev: { type: string; message?: string; payload?: Record<string, unknown> }) => {
      if (ev.type === 'context_usage' && typeof ev.payload?.context_pct === 'number') {
        setContextPct(ev.payload.context_pct)
      }
      if (ev.type === 'segment_started' && typeof ev.payload?.model === 'string') {
        setRuntimeModel(ev.payload.model)
      }
      if (ev.type === 'done' && typeof ev.payload === 'undefined') {
        return
      }
      setEvents((prev) => [
        ...prev,
        { type: ev.type, title: ev.message || ev.type, body: ev.message, payload: ev.payload },
      ])
    }

    const startGatewayStream = (lastSeq: number) => {
      let seenSeq = lastSeq
      unsubscribe = onGatewayEvent(`run:${workLogId}`, (event) => {
        if (cancelled || event.event !== 'agent.run') return
        const data = event.data as {
          type?: string
          message?: string
          payload?: Record<string, unknown>
          sequence?: number
          status?: string
        }
        if (!data.type) return
        if (typeof data.sequence === 'number' && data.sequence > 0 && data.sequence <= seenSeq) return
        if (typeof data.sequence === 'number') seenSeq = Math.max(seenSeq, data.sequence)
        applyOrchestrationEvent({ type: data.type, message: data.message, payload: data.payload })
        if (data.status && ['completed', 'failed', 'cancelled'].includes(data.status)) {
          setStatus(data.status as WorkLogStatus)
          unsubscribe?.()
          unsubscribe = null
        }
      })
    }

    const pollWorkforce = async () => {
      try {
        const data = await fetchWorkLogEvents(workLogId)
        if (cancelled) return
        setEvents(data.events ?? [])
        setStatus(data.status ?? null)
        setTaskSubject(data.task_subject ?? null)
        setTokensUsed(data.tokens_used ?? null)
        setError(null)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('workforce.runLog.loadError'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const init = async () => {
      try {
        const orch = await fetchRunEvents(workLogId)
        if (cancelled) return
        setEvents(
          orch.events.map((ev) => ({
            type: ev.type,
            title: ev.message || ev.type,
            body: ev.message,
            payload: ev.payload,
          })),
        )
        setStatus(orch.status as WorkLogStatus)
        setRuntimeModel(typeof orch.runtime_snapshot?.model === 'string' ? orch.runtime_snapshot.model : null)
        const lastUsage = [...orch.events].reverse().find((e) => e.type === 'context_usage')
        if (lastUsage && typeof lastUsage.payload?.context_pct === 'number') {
          setContextPct(lastUsage.payload.context_pct)
        }
        setError(null)
        setLoading(false)
        const lastSeq = orch.events.reduce((m, e) => Math.max(m, e.sequence ?? 0), -1)
        if (orch.status === 'running' || orch.status === 'queued') {
          startGatewayStream(lastSeq)
        }
      } catch {
        // Not an orchestration run; fall back to the workforce work-log poller.
        void pollWorkforce()
        pollTimer = setInterval(() => void pollWorkforce(), 2000)
      }
    }

    void init()
    return () => {
      cancelled = true
      unsubscribe?.()
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [workLogId, t])

  const headlineEvents = events.filter((ev) =>
    isCockpitHeadlineEvent({ event_type: ev.type, message: ev.title || ev.body }),
  )
  const visibleEvents = headlineEvents.length > 0 ? headlineEvents : events

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/60 bg-bg-surface px-4 py-3 shadow-card">
        <p className="text-[15px] font-semibold text-text-heading">
          {formatWorkLogSubject(taskSubject, t, t('workforce.runLog.title'))}
        </p>
        <p className="mt-1 text-[13px] text-text-muted">
          {workLogStatusLabel(status, t) || t('workforce.runLog.unknown')}
          {runtimeModel ? ` · ${humanizeModelId(runtimeModel)}` : null}
          {tokensUsed != null ? ` · ${tokensUsed} ${t('workforce.runLog.tokens').toLowerCase()}` : null}
        </p>
        {contextPct != null ? (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-text-muted">
              <span>{t('workforce.runLog.contextWindow')}</span>
              <span>{contextPct}%</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${contextPct}%` }} />
            </div>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-3">
          <Link to={agentRunsPath('all')} className="text-[12.5px] font-medium text-accent hover:underline">
            {t('workforce.runLog.openConversation')}
          </Link>
          <Link to="/agenda" className="text-[12.5px] font-medium text-accent hover:underline">
            {t('workforce.runLog.backToAgenda')}
          </Link>
        </div>
      </div>

      <div className="max-h-96 space-y-1.5 overflow-y-auto rounded-xl border border-border/60 bg-bg-surface p-3">
        <p className="mb-2 text-[11px] text-text-muted">{t('workforce.runLog.stepsHint')}</p>
        {loading && events.length === 0 && !error ? (
          <p className="text-[13px] text-text-muted">{t('workforce.runLog.loadingEvents')}</p>
        ) : error ? (
          <p className="text-[13px] text-status-error">{error}</p>
        ) : visibleEvents.length === 0 ? (
          <p className="text-[13px] text-text-muted">{t('workforce.runLog.waiting')}</p>
        ) : (
          visibleEvents.map((ev, i) => {
            const label =
              activityEventMessage(ev.title || ev.body, t) ||
              activityEventTypeLabel(ev.type, t) ||
              t('workforce.runLog.eventFallback')
            return (
              <details key={i} className="rounded-lg bg-bg-elevated px-2.5 py-2">
                <summary className="cursor-pointer text-[13px] text-text-primary">{label}</summary>
                {ev.body && ev.body !== ev.title ? (
                  <p className="mt-1 whitespace-pre-wrap text-[12px] text-text-muted">{ev.body}</p>
                ) : null}
              </details>
            )
          })
        )}
      </div>
    </div>
  )
}
