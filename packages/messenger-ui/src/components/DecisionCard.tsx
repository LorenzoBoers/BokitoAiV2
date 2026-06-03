import { useEffect, useState } from 'react'
import type { ApiConfig, DecisionRequest } from '../index'
import { approveDecision, getDecision, rejectDecision } from '../index'

type Props = {
  config: ApiConfig
  decisionId: string
  onResolved?: () => void
}

export function DecisionCard({ config, decisionId, onResolved }: Props) {
  const [decision, setDecision] = useState<DecisionRequest | null>(null)
  const [alwaysAuto, setAlwaysAuto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    getDecision(config, decisionId)
      .then(setDecision)
      .catch(console.error)
  }, [config, decisionId])

  async function handleApprove(optionId: string) {
    setBusy(true)
    try {
      await approveDecision(config, decisionId, optionId, { alwaysAuto })
      setResolved(true)
      onResolved?.()
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  async function handleReject() {
    const optionId = decision?.options[0]?.id ?? 'reject'
    setBusy(true)
    try {
      await rejectDecision(config, decisionId, optionId)
      setResolved(true)
      onResolved?.()
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  if (resolved) {
    return <div className="bk-decision-inline bk-decision-inline--resolved">Beslissing verwerkt.</div>
  }

  if (!decision) {
    return <div className="bk-decision-inline bk-decision-inline--loading">Beslissing laden...</div>
  }

  return (
    <article className="bk-decision-inline">
      <h4>{decision.title}</h4>
      {decision.summary ? <p>{decision.summary}</p> : null}
      <label className="bk-decision-auto-label">
        <input
          type="checkbox"
          checked={alwaysAuto}
          onChange={(e) => setAlwaysAuto(e.target.checked)}
          disabled={busy}
        />
        Voortaan automatisch oppakken
      </label>
      <div className="bk-decision-inline-actions">
        {decision.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className="bk-decision-inline-approve"
            disabled={busy}
            onClick={() => void handleApprove(opt.id)}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          className="bk-decision-inline-reject"
          disabled={busy}
          onClick={() => void handleReject()}
        >
          Afwijzen
        </button>
      </div>
    </article>
  )
}
