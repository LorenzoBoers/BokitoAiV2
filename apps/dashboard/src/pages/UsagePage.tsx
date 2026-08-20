import { useCallback, useEffect, useState } from 'react'
import { OctagonAlert, RefreshCw } from 'lucide-react'
import ContentHeader from '../components/shell/ContentHeader'
import CockpitTabs from '../components/shell/CockpitTabs'
import { useAuth } from '../context/AuthContext'
import {
  bokitoGetBudget,
  bokitoGetCockpitSummary,
  bokitoGetUsageBreakdown,
  bokitoPatchBudget,
  type CockpitSummary,
  type SpendBudget,
  type SpendPeriodStatus,
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

function BudgetBar({
  label,
  period,
  format,
}: {
  label: string
  period: SpendPeriodStatus
  format: (value: number) => string
}) {
  const pct = period.cap ? Math.min(100, Math.round(period.ratio * 100)) : 0
  const barColor = period.exceeded
    ? 'bg-status-error'
    : period.ratio >= 0.8
      ? 'bg-amber-500'
      : 'bg-accent'
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="font-medium text-text-primary">{label}</span>
        <span className="text-text-muted">
          {format(period.used)}
          {period.cap ? ` of ${format(period.cap)}` : ' (no cap)'}
        </span>
      </div>
      {period.cap ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-hover/70">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  )
}

export default function UsagePage() {
  const { token } = useAuth()
  const [summary, setSummary] = useState<CockpitSummary | null>(null)
  const [breakdown, setBreakdown] = useState<UsageBreakdown | null>(null)
  const [budget, setBudget] = useState<SpendBudget | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [capDraft, setCapDraft] = useState<{ tokens: string; usd: string } | null>(null)
  const [savingCaps, setSavingCaps] = useState(false)
  const [capError, setCapError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    Promise.all([
      bokitoGetCockpitSummary(token),
      bokitoGetUsageBreakdown(token, 30),
      bokitoGetBudget(token),
    ])
      .then(([s, b, bud]) => {
        setSummary(s)
        setBreakdown(b)
        setBudget(bud)
      })
      .catch((err) => setError(formatApiErrorMessage(err, 'Could not load usage.')))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  const startEditCaps = useCallback(() => {
    if (!budget) return
    setCapError(null)
    setCapDraft({
      tokens: budget.config.daily_token_cap ? String(budget.config.daily_token_cap) : '',
      usd: budget.config.monthly_customer_micros_cap
        ? String(budget.config.monthly_customer_micros_cap / 1_000_000)
        : '',
    })
  }, [budget])

  const saveCaps = useCallback(() => {
    if (!token || !capDraft) return
    setSavingCaps(true)
    setCapError(null)
    const tokensCap = capDraft.tokens.trim() ? Number(capDraft.tokens) : null
    const usdCap = capDraft.usd.trim() ? Number(capDraft.usd) : null
    if ((tokensCap !== null && !Number.isFinite(tokensCap)) || (usdCap !== null && !Number.isFinite(usdCap))) {
      setCapError('Caps must be numbers (leave empty for no cap).')
      setSavingCaps(false)
      return
    }
    bokitoPatchBudget(token, {
      daily_token_cap: tokensCap ? Math.round(tokensCap) : null,
      monthly_customer_micros_cap: usdCap ? Math.round(usdCap * 1_000_000) : null,
    })
      .then((next) => {
        setBudget(next)
        setCapDraft(null)
      })
      .catch((err) => setCapError(formatApiErrorMessage(err, 'Could not save budget caps.')))
      .finally(() => setSavingCaps(false))
  }, [token, capDraft])

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
            className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      <CockpitTabs />

      {error ? <ApiErrorBanner message={error} onRetry={load} /> : null}

      {budget?.status.blocked ? (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-status-error/40 bg-status-error/10 px-4 py-3 text-[12.5px] text-text-primary">
          <OctagonAlert size={15} className="shrink-0 text-status-error" />
          <span>
            The LLM budget is exhausted: AI calls on platform keys are paused until the cap is
            raised or the period resets. Models on your own keys keep working.
          </span>
        </div>
      ) : null}

      {budget ? (
        <div className="mb-5 rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-text-heading">Budget (platform keys)</h3>
            {capDraft ? null : (
              <button
                type="button"
                onClick={startEditCaps}
                className="rounded-md border border-border/60 px-2.5 py-1 text-[11.5px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
              >
                Edit caps
              </button>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <BudgetBar
              label="Tokens today"
              period={budget.status.daily_tokens}
              format={formatNumber}
            />
            <BudgetBar
              label="Billable spend this month"
              period={budget.status.monthly_customer_micros}
              format={formatUsd}
            />
          </div>
          {capDraft ? (
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border/60 pt-3">
              <label className="flex flex-col gap-1 text-[11.5px] text-text-muted">
                Daily token cap
                <input
                  value={capDraft.tokens}
                  onChange={(e) => setCapDraft({ ...capDraft, tokens: e.target.value })}
                  placeholder="No cap"
                  inputMode="numeric"
                  className="w-36 rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-text-muted">
                Monthly spend cap (USD)
                <input
                  value={capDraft.usd}
                  onChange={(e) => setCapDraft({ ...capDraft, usd: e.target.value })}
                  placeholder="No cap"
                  inputMode="decimal"
                  className="w-36 rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveCaps}
                  disabled={savingCaps}
                  className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60"
                >
                  {savingCaps ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setCapDraft(null)}
                  className="rounded-md px-2.5 py-1.5 text-[11.5px] font-medium text-text-muted transition-colors hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
              {capError ? <p className="w-full text-[11.5px] text-status-error">{capError}</p> : null}
            </div>
          ) : null}
          <p className="mt-3 text-[11.5px] text-text-muted">
            Owners and admins get an alert at 80% and 100%. Leave a cap empty to remove it.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border/60 bg-bg-surface px-4 py-3.5 shadow-card">
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
          <div className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
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

          <div className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
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
