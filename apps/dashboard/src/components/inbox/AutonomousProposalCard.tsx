import { useState } from 'react'
import { Button } from '../ui/button'
import type { MessageRow } from '../../lib/messages-api'
import {
  approveAutonomousProposal,
  deferAutonomousProposal,
  rejectAutonomousProposal,
} from '../../lib/messages-api'

type Props = {
  message: MessageRow
  onResolved: () => void
}

export function AutonomousProposalCard({ message, onResolved }: Props) {
  const [busy, setBusy] = useState(false)
  const [ackHighRisk, setAckHighRisk] = useState(false)
  const payload = message.payload ?? {}
  const highRisk = payload.high_risk === true || payload.kind === 'high_risk_autonomous_proposal'

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      onResolved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised p-4">
      <span className="inline-block rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text-muted">
        Suggested by your team
      </span>
      {highRisk ? (
        <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
          Needs your approval — may affect users, spend money, or contact customers
        </span>
      ) : null}
      <h3 className="mt-2 font-medium text-text-primary">{message.subject || 'Proposal'}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{message.body}</p>
      {highRisk ? (
        <label className="mt-3 flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={ackHighRisk}
            onChange={(e) => setAckHighRisk(e.target.checked)}
          />
          I understand this may change what users see or contact customers
        </label>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || (highRisk && !ackHighRisk)}
          onClick={() => act(() => approveAutonomousProposal(message.id))}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => act(() => deferAutonomousProposal(message.id))}
        >
          Defer 7 days
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => act(() => rejectAutonomousProposal(message.id))}
        >
          Reject
        </Button>
      </div>
    </div>
  )
}
