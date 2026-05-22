import { useEffect, useState } from 'react'
type WorkLogEvent = {
  type: string
  title?: string
  body?: string
  payload?: Record<string, unknown>
}
import { workforceRoutes } from '../../api/routes'
import { xanoGetWorkforce } from '../../lib/xano'

type Props = {
  workLogId: string
}

export function LiveWorkLog({ workLogId }: Props) {
  const [events, setEvents] = useState<WorkLogEvent[]>([])

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const data = await xanoGetWorkforce<{ events: WorkLogEvent[] }>(
          workforceRoutes.runs.events(workLogId)
        )
        if (!cancelled) setEvents(data.events ?? [])
      } catch {
        /* admin-only endpoint may 404 for end users */
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
    <div className="max-h-96 space-y-2 overflow-y-auto rounded border border-border-subtle bg-surface-raised p-3 font-mono text-xs">
      {events.length === 0 ? (
        <p className="text-text-muted">Waiting for events…</p>
      ) : (
        events.map((ev, i) => (
          <details key={i} className="rounded bg-surface-muted p-2">
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
  )
}
