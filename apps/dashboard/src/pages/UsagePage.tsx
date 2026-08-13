import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import ContentHeader from '../components/shell/ContentHeader'
import CockpitTabs from '../components/shell/CockpitTabs'
import { useAuth } from '../context/AuthContext'
import {
  bokitoGetCockpitSummary,
  bokitoGetUsageBreakdown,
  type CockpitSummary,
  type UsageBreakdown,
} from '../lib/bokito-api'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

function formatCost(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function formatUsd(micros: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(micros / 1_000_000)
}

export default function UsagePage() {
  const { token } = useAuth()
  const [summary, setSummary] = useState<CockpitSummary | null>(null)
  const [breakdown, setBreakdown] = useState<UsageBreakdown | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    Promise.all([bokitoGetCockpitSummary(token), bokitoGetUsageBreakdown(token, 30)])
      .then(([s, b]) => {
        setSummary(s)
        setBreakdown(b)
      })
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
        title="Cockpit"
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

      <CockpitTabs />

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

      {breakdown ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-border/55 bg-bg-surface/85 p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold text-text-heading">By model ({breakdown.days}d)</h3>
              <span className="text-[11px] text-text-muted">
                Billable {formatUsd(breakdown.total_customer_cost_micros)}
              </span>
            </div>
            <div className="space-y-2">
              {breakdown.by_model.length === 0 ? (
                <p className="text-[12px] text-text-muted">No model usage yet.</p>
              ) : (
                breakdown.by_model.map((row) => (
                  <div
                    key={`${row.model}-${row.key_source}`}
                    className="flex items-center justify-between gap-3 text-[12.5px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-primary">{row.model || 'unknown'}</p>
                      <p className="text-[11px] text-text-muted">
                        {formatNumber(row.tokens)} tokens ·{' '}
                        {row.billable ? (
                          <span className="text-amber-500">billable {formatUsd(row.customer_cost_micros)}</span>
                        ) : (
                          <span className="text-status-success">BYOK (no charge)</span>
                        )}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/55 bg-bg-surface/85 p-4">
            <h3 className="mb-3 text-[13px] font-semibold text-text-heading">By agent ({breakdown.days}d)</h3>
            <div className="space-y-2">
              {breakdown.by_agent.length === 0 ? (
                <p className="text-[12px] text-text-muted">No agent usage yet.</p>
              ) : (
                breakdown.by_agent.map((row) => (
                  <div
                    key={row.agent_id ?? 'system'}
                    className="flex items-center justify-between gap-3 text-[12.5px]"
                  >
                    <p className="min-w-0 truncate font-medium text-text-primary">{row.agent_name}</p>
                    <p className="shrink-0 text-[11px] text-text-muted">
                      {formatNumber(row.tokens)} tok · {formatUsd(row.customer_cost_micros)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-[12px] text-text-muted">
        Models run on your own keys show no charge (BYOK); models on Bokito&apos;s keys are billed per token with
        the platform markup applied.
      </p>
    </div>
  )
}
