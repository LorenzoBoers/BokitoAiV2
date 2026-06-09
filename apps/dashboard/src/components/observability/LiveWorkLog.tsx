import { useEffect, useState } from 'react'
import {
  fetchWorkLogEvents,
  type WorkLogEvent,
  type WorkLogStatus,
} from '../../lib/work-logs-api'
import { fetchRunEvents } from '../../lib/orchestration-api'

type Props = {
  workLogId: string
}

export function LiveWorkLog({ workLogId }: Props) {
  const [events, setEvents] = useState<WorkLogEvent[]>([])
  const [status, setStatus] = useState<WorkLogStatus | null>(null)
  const [taskSubject, setTaskSubject] = useState<string | null>(null)
  const [tokensUsed, setTokensUsed] = useState<number | null>(null)
  const [runtimeModel, setRuntimeModel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
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
          setError(null)
          setLoading(false)
          return
        } catch {
          /* fall through to workforce work log API */
        }

        const data = await fetchWorkLogEvents(workLogId)
        if (cancelled) return
        setEvents(data.events ?? [])
        setStatus(data.status ?? null)
        setTaskSubject(data.task_subject ?? null)
        setTokensUsed(data.tokens_used ?? null)
        setError(null)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load run events')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void poll()
    const t = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(t)
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
