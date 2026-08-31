import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { OctagonAlert, RefreshCw } from 'lucide-react'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
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
import { formatAppTime } from '../lib/app-locale'
import { formatAppNumber, formatAppUsdCents } from '../lib/app-number'
import { WEBSITE_WIDGET_PATH } from '../lib/assistant-settings-path'
import { inboxPath } from '../lib/messages-paths'
import { humanizeModelId } from '../lib/model-label'
import { parseUsageDays, usageBreakdownToCsv } from '../lib/usage-csv'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'

function isSystemUsageName(name: string): boolean {
  return /system|systeem/i.test(name)
}

function formatUsd(micros: number, language?: string) {
  return formatAppUsdCents(micros / 10_000, language)
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
  const { t } = useTranslation('nav')
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
          {period.cap
            ? t('usagePage.usedOfCap', { used: format(period.used), cap: format(period.cap) })
            : `${format(period.used)} ${t('usagePage.noCapParen')}`}
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
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const locale = i18n.language
  const num = (value: number) => formatAppNumber(value, locale)
  const usd = (value: number) => formatUsd(value, locale)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [summary, setSummary] = useState<CockpitSummary | null>(null)
  const [breakdown, setBreakdown] = useState<UsageBreakdown | null>(null)
  const [budget, setBudget] = useState<SpendBudget | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const days = parseUsageDays(searchParams.get('days'))
  const [capDraft, setCapDraft] = useState<{ tokens: string; usd: string } | null>(null)
  const [savingCaps, setSavingCaps] = useState(false)
  const [capError, setCapError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    Promise.all([
      bokitoGetCockpitSummary(token),
      bokitoGetUsageBreakdown(token, days),
      bokitoGetBudget(token),
    ])
      .then(([s, b, bud]) => {
        setSummary(s)
        setBreakdown(b)
        setBudget(bud)
        setRefreshedAt(new Date())
      })
      .catch((err) => setError(formatApiErrorMessage(err, t('usagePage.couldNotLoad'))))
      .finally(() => setLoading(false))
  }, [token, t, days])

  useUnsavedChangesGuard(capDraft !== null, t('usagePage.unsavedLeave'))

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
      setCapError(t('usagePage.capsMustBeNumbers'))
      setSavingCaps(false)
      return
    }
    if (!tokensCap && !usdCap && (budget?.config.daily_token_cap || budget?.config.monthly_customer_micros_cap)) {
      if (!window.confirm(t('usagePage.confirmClearCaps'))) {
        setSavingCaps(false)
        return
      }
    }
    bokitoPatchBudget(token, {
      daily_token_cap: tokensCap ? Math.round(tokensCap) : null,
      monthly_customer_micros_cap: usdCap ? Math.round(usdCap * 1_000_000) : null,
    })
      .then((next) => {
        setBudget(next)
        setCapDraft(null)
      })
      .catch((err) => setCapError(formatApiErrorMessage(err, t('usagePage.couldNotSave'))))
      .finally(() => setSavingCaps(false))
  }, [token, capDraft, t, budget])

  const stats = summary
    ? [
        {
          key: 'tokens',
          label: t('usagePage.tokens30d', { days }),
          value: num(breakdown?.total_tokens ?? summary.tokens_month),
        },
        {
          key: 'cost',
          label: t('usagePage.cost30d', { days }),
          value: breakdown
            ? usd(breakdown.total_customer_cost_micros)
            : formatAppUsdCents(summary.cost_cents_month, locale),
        },
        {
          key: 'conversations',
          label: t('usagePage.conversations7d'),
          value: num(summary.volume_week),
          hint: summary.volume_week === 0 ? t('usagePage.conversationsEmptyHint') : null,
          hintTo: inboxPath('open'),
          hintLink: t('usagePage.openInbox'),
        },
        {
          key: 'autonomy',
          label: t('usagePage.autonomyRate'),
          value: `${num(summary.autonomy_rate_pct)}%`,
          hint: summary.autonomy_rate_pct === 0 ? t('usagePage.autonomyEmptyHint') : null,
          hintTo: '/settings/govern?tab=policy',
          hintLink: t('usagePage.openGovern'),
        },
        {
          key: 'time',
          label: t('usagePage.timeSaved'),
          value: `${num(summary.time_saved_minutes_week)} min`,
          hint: summary.time_saved_minutes_week === 0 ? t('usagePage.timeSavedEmptyHint') : null,
          hintTo: '/agents',
          hintLink: t('usagePage.openAgents'),
        },
        {
          key: 'feedback',
          label: t('usagePage.avgFeedback'),
          value: summary.avg_feedback_score > 0 ? num(summary.avg_feedback_score) : '-',
          hint: summary.avg_feedback_score > 0 ? null : t('usagePage.feedbackEmptyHint'),
          hintTo: WEBSITE_WIDGET_PATH,
          hintLink: t('usagePage.openWebsiteWidget'),
        },
      ]
    : []

  return (
    <div>
      <PageGuideBanner page="cockpit" className="mb-4" />
      <ContentHeader
        title={t('settings.links.reports', { defaultValue: 'Reports' })}
        subtitle={t('pageHeaders.cockpitUsage')}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border/60 p-0.5">
              {([7, 30, 90] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams)
                    if (value === 30) params.delete('days')
                    else params.set('days', String(value))
                    setSearchParams(params, { replace: true })
                  }}
                  className={`rounded-md px-2 py-1 text-[11.5px] font-medium ${
                    days === value ? 'bg-bg-hover text-text-heading' : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {t(`usagePage.period${value}` as 'usagePage.period7')}
                </button>
              ))}
            </div>
            {refreshedAt ? (
              <span className="text-[11px] text-text-muted">
                {t('usagePage.refreshedAt', { time: formatAppTime(refreshedAt, locale) })}
              </span>
            ) : null}
            {breakdown ? (
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([usageBreakdownToCsv(breakdown)], { type: 'text/csv;charset=utf-8' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `bokito-usage-${days}d.csv`
                  a.click()
                  URL.revokeObjectURL(url)
                  toast.success(t('usagePage.exported'))
                }}
                className="rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('usagePage.exportCsv')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {t('usagePage.refresh')}
            </button>
          </div>
        }
      />

      <CockpitTabs />

      {error ? (
        <div className="space-y-2">
          <ApiErrorBanner message={error} onRetry={load} />
          {!summary ? (
            <div className="rounded-xl border border-dashed border-border/60 px-4 py-3">
              <p className="text-[12px] text-text-muted">{t('usagePage.errorRecoveryHint')}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                <Link to="/communication/new" className="text-[12px] font-medium text-accent hover:underline">
                  {t('usagePage.startChat')}
                </Link>
                <Link to="/agents" className="text-[12px] font-medium text-accent hover:underline">
                  {t('usagePage.openAgents')}
                </Link>
                <Link to="/settings/setup" className="text-[12px] font-medium text-accent hover:underline">
                  {t('usagePage.openSetup')}
                </Link>
                <Link to="/settings/models" className="text-[12px] font-medium text-accent hover:underline">
                  {t('usagePage.openModels')}
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {budget?.status.blocked ? (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-status-error/40 bg-status-error/10 px-4 py-3 text-[12.5px] text-text-primary">
          <OctagonAlert size={15} className="shrink-0 text-status-error" />
          <span>
            {t('usagePage.budgetBlocked')}
          </span>
        </div>
      ) : null}

      {budget ? (
        <div className="mb-5 rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-text-heading">{t('usagePage.budgetTitle')}</h3>
            {capDraft ? null : (
              <button
                type="button"
                onClick={startEditCaps}
                className="rounded-md border border-border/60 px-2.5 py-1 text-[11.5px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('usagePage.editCaps')}
              </button>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <BudgetBar
              label={t('usagePage.tokensToday')}
              period={budget.status.daily_tokens}
              format={num}
            />
            <BudgetBar
              label={t('usagePage.spendMonth')}
              period={budget.status.monthly_customer_micros}
              format={usd}
            />
          </div>
          {capDraft ? (
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border/60 pt-3">
              <label className="flex flex-col gap-1 text-[11.5px] text-text-muted">
                {t('usagePage.dailyCap')}
                <input
                  value={capDraft.tokens}
                  onChange={(e) => setCapDraft({ ...capDraft, tokens: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveCaps()
                    }
                  }}
                  placeholder={t('usagePage.noCap')}
                  inputMode="numeric"
                  className="w-36 rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-text-muted">
                {t('usagePage.monthlyCap')}
                <input
                  value={capDraft.usd}
                  onChange={(e) => setCapDraft({ ...capDraft, usd: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveCaps()
                    }
                  }}
                  placeholder={t('usagePage.noCap')}
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
                  {savingCaps ? t('usagePage.saving') : t('usagePage.save')}
                </button>
                <button
                  type="button"
                  onClick={() => setCapDraft(null)}
                  className="rounded-md px-2.5 py-1.5 text-[11.5px] font-medium text-text-muted transition-colors hover:text-text-primary"
                >
                  {t('usagePage.cancel')}
                </button>
              </div>
              {capError ? <p className="w-full text-[11.5px] text-status-error">{capError}</p> : null}
            </div>
          ) : null}
          <p className="mt-3 text-[11.5px] text-text-muted">
            {t('usagePage.capsHint')}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.key} className="rounded-xl border border-border/60 bg-bg-surface px-4 py-3.5 shadow-card">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">{stat.label}</p>
            <p className="mt-2 text-[22px] font-semibold leading-none text-text-heading">{stat.value}</p>
            {stat.hint && stat.hintTo && stat.hintLink ? (
              <p className="mt-2 text-[11px] leading-snug text-text-muted">
                {stat.hint}{' '}
                <Link to={stat.hintTo} className="font-medium text-accent hover:underline">
                  {stat.hintLink}
                </Link>
              </p>
            ) : null}
          </div>
        ))}
        {!summary && !error ? (
          <p className="col-span-full px-1 py-6 text-[12.5px] text-text-muted">{t('usagePage.loading')}</p>
        ) : null}
      </div>

      {breakdown ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold text-text-heading">{t('usagePage.byModel', { days: breakdown.days })}</h3>
              <span className="text-[11px] text-text-muted">
                {t('usagePage.billable', { amount: usd(breakdown.total_customer_cost_micros) })}
              </span>
            </div>
            <div className="space-y-2">
              {breakdown.by_model.length === 0 ? (
                <div>
                  <p className="text-[12px] text-text-muted">{t('usagePage.noModelUsage')}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <Link to="/communication/new" className="text-[12px] font-medium text-accent hover:underline">
                      {t('usagePage.startChat')}
                    </Link>
                    <Link to="/agents" className="text-[12px] font-medium text-accent hover:underline">
                      {t('usagePage.openAgents')}
                    </Link>
                    <Link to="/settings/setup" className="text-[12px] font-medium text-accent hover:underline">
                      {t('usagePage.openSetup')}
                    </Link>
                    <Link to="/settings/models" className="text-[12px] font-medium text-accent hover:underline">
                      {t('usagePage.openModels')}
                    </Link>
                  </div>
                </div>
              ) : (
                breakdown.by_model.map((row) => (
                  <Link
                    key={`${row.model}-${row.key_source}`}
                    to="/settings/models"
                    className="flex items-center justify-between gap-3 rounded-md px-1 py-0.5 text-[12.5px] hover:bg-bg-hover/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-primary">
                        {humanizeModelId(row.model) || t('usagePage.unknown')}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {t('usagePage.tokens', { count: num(row.tokens) })} ·{' '}
                        {row.billable ? (
                          <span className="text-amber-500">
                            {t('usagePage.billableRow', { amount: usd(row.customer_cost_micros) })}
                          </span>
                        ) : (
                          <span className="text-status-success">{t('usagePage.byok')}</span>
                        )}
                      </p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
            <h3 className="mb-3 text-[13px] font-semibold text-text-heading">{t('usagePage.byAgent', { days: breakdown.days })}</h3>
            <div className="space-y-2">
              {breakdown.by_agent.length === 0 ? (
                <div>
                  <p className="text-[12px] text-text-muted">{t('usagePage.noAgentUsage')}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <Link to="/agents" className="text-[12px] font-medium text-accent hover:underline">
                      {t('usagePage.openAgents')}
                    </Link>
                    <Link to="/communication/new" className="text-[12px] font-medium text-accent hover:underline">
                      {t('usagePage.startChat')}
                    </Link>
                    <Link to="/settings/setup" className="text-[12px] font-medium text-accent hover:underline">
                      {t('usagePage.openSetup')}
                    </Link>
                    <Link to="/settings/models" className="text-[12px] font-medium text-accent hover:underline">
                      {t('usagePage.openModels')}
                    </Link>
                  </div>
                </div>
              ) : (
                breakdown.by_agent.map((row) => {
                  const body = (
                    <>
                      <p className="min-w-0 truncate font-medium text-text-primary">{row.agent_name}</p>
                      <p className="shrink-0 text-[11px] text-text-muted">
                        {t('usagePage.tokensShort', { count: num(row.tokens) })} · {usd(row.customer_cost_micros)}
                      </p>
                    </>
                  )
                  return row.agent_id ? (
                    <Link
                      key={row.agent_id}
                      to={`/agents/${row.agent_id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-1 py-0.5 text-[12.5px] hover:bg-bg-hover/50"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div
                      key="system"
                      className="flex items-center justify-between gap-3 text-[12.5px]"
                    >
                      {body}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
            <h3 className="mb-3 text-[13px] font-semibold text-text-heading">{t('usagePage.byUser', { days: breakdown.days })}</h3>
            <div className="space-y-2">
              {(breakdown.by_user ?? []).length === 0 ? (
                <div>
                  <p className="text-[12px] text-text-muted">{t('usagePage.noUserUsage')}</p>
                  <Link
                    to="/communication/new"
                    className="mt-2 inline-block text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('usagePage.startChat')}
                  </Link>
                  <Link
                    to="/settings/setup"
                    className="mt-2 ml-3 inline-block text-[12px] font-medium text-accent hover:underline"
                  >
                    {t('usagePage.openSetup')}
                  </Link>
                </div>
              ) : (
                (breakdown.by_user ?? []).map((row) => (
                  <div
                    key={row.user_id ?? 'system'}
                    className="flex items-center justify-between gap-3 text-[12.5px]"
                  >
                    <p className="min-w-0 truncate font-medium text-text-primary">
                      {isSystemUsageName(row.user_name) ? t('usagePage.systemUser') : row.user_name}
                    </p>
                    <p className="shrink-0 text-[11px] text-text-muted">
                      {t('usagePage.tokensShort', { count: num(row.tokens) })} · {usd(row.customer_cost_micros)}
                    </p>
                  </div>
                ))
              )}
            </div>
            <p className="mt-3 text-[11px] text-text-muted">
              {t('usagePage.userHint')}
            </p>
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-[12px] text-text-muted">
        {t('usagePage.byokFooter')}
      </p>
    </div>
  )
}
