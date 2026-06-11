import { useEffect, useState } from 'react'
import {
  fetchWorkLogEvents,
  type WorkLogEvent,
  type WorkLogStatus,
} from '../../lib/work-logs-api'
import { fetchRunEvents } from '../../lib/orchestration-api'
import { onGatewayEvent } from '../../lib/gateway'

type Props = {
  workLogId: string
}

export function LiveWorkLog({ workLogId }: Props) {
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
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load run events')
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
  }, [workLogId])

  return (
    <div className="space-y-3">
      <div className="rounded border border-border/60 bg-bg-elevated px-3 py-2 text-sm">
        <p className="font-medium text-text-primary">{taskSubject || 'Agent run'}</p>
        <p className="text-text-muted">
          Status: {status || 'unknown'}
          {runtimeModel ? ` | Model: ${runtimeModel}` : null}
          {tokensUsed != null ? ` | Tokens: ${tokensUsed}` : null}
        </p>
        {contextPct != null ? (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-text-muted">
              <span>Context window</span>
              <span>{contextPct}%</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-bg-surface overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${contextPct}%` }} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="max-h-96 space-y-2 overflow-y-auto rounded border border-border/60 bg-bg-surface p-3 font-mono text-xs">
        {loading && events.length === 0 && !error ? (
          <p className="text-text-muted">Loading events...</p>
        ) : error ? (
          <p className="text-destructive">{error}</p>
        ) : events.length === 0 ? (
          <p className="text-text-muted">Waiting for events...</p>
        ) : (
          events.map((ev, i) => (
            <details key={i} className="rounded bg-bg-elevated p-2">
              <summary className="cursor-pointer text-text-primary">
                [{ev.type}] {ev.title || 'event'}
              </summary>
              {ev.body ? <pre className="mt-1 whitespace-pre-wrap text-text-muted">{ev.body}</pre> : null}
              {ev.payload ? (
                <pre className="mt-1 whitespace-pre-wrap text-text-muted">
                  {JSON.stringify(ev.payload, null, 2)}
                </pre>
              ) : null}
            </details>
          ))
        )}
      </div>
    </div>
  )
}
