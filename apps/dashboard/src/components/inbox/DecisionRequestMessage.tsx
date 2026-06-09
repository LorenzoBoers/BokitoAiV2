import { useState } from 'react'
import { cn } from '../../lib/utils'
import { resolveThreadDecision, type InboxEvent, type InboxMessage, type ThreadId } from '../../lib/inbox-api'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../ui/button'

type Props = {
  message: InboxMessage
  threadId: ThreadId
  events: InboxEvent[]
  onResolved?: () => void
}

function isDecisionResolved(message: InboxMessage, events: InboxEvent[]): boolean {
  if (!message.decisionId) return false
  return events.some((event) => {
    if (!event.eventType.startsWith('decision_')) return false
    const payloadId = event.payload?.decision_id
    return typeof payloadId === 'string' && payloadId === message.decisionId
  })
}

export default function DecisionRequestMessage({ message, threadId, events, onResolved }: Props) {
  const { token } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolved = isDecisionResolved(message, events)
  const body = message.bodyText?.trim() || message.bodyPreview || message.subject || 'Decision needed'

  async function act(action: 'approve' | 'defer' | 'reject') {
    if (!token || resolved) return
    setBusy(true)
    setError(null)
    try {
      await resolveThreadDecision(token, threadId, message.id, action)
      onResolved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve decision.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'w-full max-w-3xl min-w-0 rounded-2xl border px-4 py-3',
          resolved
            ? 'border-border/50 bg-bg-surface/80'
            : 'border-accent/30 bg-accent/5',
        )}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Decision</span>
          {resolved ? (
            <span className="rounded-full bg-bg-hover px-2 py-0.5 text-[10px] font-medium text-text-secondary">
              Resolved
            </span>
          ) : null}
        </div>
        {message.subject ? (
          <h3 className="text-sm font-medium text-text-heading">{message.subject}</h3>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{body}</p>
        {!resolved ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void act('approve')}>
              Approve
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void act('defer')}>
              Defer
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void act('reject')}>
              Reject
            </Button>
          </div>
        ) : null}
        {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
      </div>
    </div>
  )
}
