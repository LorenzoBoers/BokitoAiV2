import { useEffect, useState } from 'react'
import type { ApiConfig, DecisionRequest } from '../index'
import { approveDecision, listDecisions, rejectDecision } from '../index'

type Props = {
  config: ApiConfig
}

export function DecisionPanel({ config }: Props) {
  const [decisions, setDecisions] = useState<DecisionRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  async function refresh() {
    const items = await listDecisions(config)
    setDecisions(items)
  }

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 15000)
    return () => window.clearInterval(id)
  }, [config])

  async function handleAction(decisionId: string, optionId: string, action: 'approve' | 'reject') {
    setBusy(decisionId)
    try {
      if (action === 'approve') await approveDecision(config, decisionId, optionId)
      else await rejectDecision(config, decisionId, optionId)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  if (decisions.length === 0) {
    return <p className="bk-decisions-empty">No pending decisions.</p>
  }

  return (
    <div className="bk-decisions">
      {decisions.map((d) => (
        <article key={d.id} className="bk-decision-card">
          <h3>{d.title}</h3>
          {d.summary ? <p>{d.summary}</p> : null}
          <div className="bk-decision-options">
            {d.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={busy === d.id}
                onClick={() => void handleAction(d.id, opt.id, 'approve')}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              className="bk-decision-reject"
              disabled={busy === d.id}
              onClick={() => void handleAction(d.id, d.options[0]?.id ?? 'reject', 'reject')}
            >
              Reject
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}
