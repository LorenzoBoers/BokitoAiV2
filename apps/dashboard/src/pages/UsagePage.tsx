import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import ContentHeader from '../components/shell/ContentHeader'
import { useAuth } from '../context/AuthContext'
import { bokitoGetCockpitSummary, type CockpitSummary } from '../lib/bokito-api'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

function formatCost(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

export default function UsagePage() {
  const { token } = useAuth()
  const [summary, setSummary] = useState<CockpitSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    bokitoGetCockpitSummary(token)
      .then(setSummary)
      .catch((err) => setError(formatApiErrorMessage(err, 'Could not load usage.')))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  const stats = summary
    ? [
        { label: 'Tokens (30d)', value: formatNumber(summary.tokens_month) },
        { label: 'Cost (30d)', value: formatCost(summary.cost_cents_month) },
        { label: 'Conversations (7d)', value: formatNumber(summary.volume_week) },
        { label: 'Autonomy rate', value: `${formatNumber(summary.autonomy_rate_pct)}%` },
        { label: 'Time saved (7d)', value: `${formatNumber(summary.time_saved_minutes_week)} min` },
        {
          label: 'Avg feedback',
          value: summary.avg_feedback_score > 0 ? formatNumber(summary.avg_feedback_score) : '-',
        },
      ]
    : []

  return (
    <div>
      <ContentHeader
        title="Usage"
        subtitle="Model spend and run volume"
        meta={
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {error ? <ApiErrorBanner message={error} onRetry={load} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border/55 bg-bg-surface/85 px-4 py-3.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">{stat.label}</p>
            <p className="mt-2 text-[22px] font-semibold leading-none text-text-heading">{stat.value}</p>
          </div>
        ))}
        {!summary && !error ? (
          <p className="col-span-full px-1 py-6 text-[12.5px] text-text-muted">Loading usage...</p>
        ) : null}
      </div>

      <p className="mt-4 text-[12px] text-text-muted">
        Usage is aggregated per workspace billing period. Per-agent breakdowns appear on the agent detail pages.
      </p>
    </div>
  )
}
