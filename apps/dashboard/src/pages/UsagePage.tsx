import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import ContentHeader from '../components/shell/ContentHeader'
import CockpitTabs from '../components/shell/CockpitTabs'
import WorkspaceIdHint from '../components/shell/WorkspaceIdHint'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import {
  bokitoGetBudget,
  bokitoGetCockpitSummary,
  bokitoGetUsageBreakdown,
  bokitoGetUsageSeries,
  bokitoPatchBudget,
  type CockpitSummary,
  type SpendBudget,
  type SpendPeriodStatus,
  type UsageBreakdown,
  type UsageSeriesPoint,
} from '../lib/bokito-api'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { Callout } from '../components/ui/callout'
import { CapBar } from '../components/ui/cap-bar'
import { useConfirm } from '../components/ui/confirm-dialog'
import { SegmentedControl } from '../components/ui/segmented-control'
import { Chart } from '../components/ui/chart'
import { InsetPanel } from '../components/ui/inset-panel'
import { StatGrid, StatTile } from '../components/ui/stat-tile'
import { formatAppTime } from '../lib/app-locale'
import { formatAppNumber, formatAppUsdCents } from '../lib/app-number'
import { workspaceBrandName } from '../lib/tenant-branding'
import { forYouPath, inboxPath } from '../lib/messages-paths'
import { ModelIcon } from '../components/ui/ModelIcon'
import { humanizeModelId } from '../lib/model-label'
import { RegionBadge } from '../components/models/RegionBadge'
import { parseUsageDays, usageBreakdownToCsv } from '../lib/usage-csv'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'

const CHART_HEIGHT = 168

function isSystemUsageName(name: string): boolean {
  return /system|systeem/i.test(name)
}

function formatUsd(micros: number, language?: string) {
  return formatAppUsdCents(micros / 10_000, language)
}

const usageRow = 'flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm'
const usageLink = `${usageRow} transition-colors hover:bg-bg-hover/70`

function UsageCard({
  title,
  hint,
  extra,
  children,
}: {
  title: string
  hint?: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel min-w-0 overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-heading">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-text-muted">{hint}</p> : null}
        </div>
        {extra ? <div className="shrink-0 pt-0.5 text-xs tabular-nums text-text-muted">{extra}</div> : null}
      </div>
      <div className="space-y-0.5 p-3">{children}</div>
    </section>
  )
}

function KpiInset({ label, value }: { label: string; value: string }) {
  return (
    <InsetPanel padding="sm" className="flex h-full flex-col justify-center px-3 py-3">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="mt-1 block tabular-nums text-2xl font-semibold text-text-heading">{value}</span>
    </InsetPanel>
  )
}

export default function UsagePage() {
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const locale = i18n.language
  const num = (value: number) => formatAppNumber(value, locale)
  const usd = (value: number) => formatUsd(value, locale)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [summary, setSummary] = useState<CockpitSummary | null>(null)
  const [breakdown, setBreakdown] = useState<UsageBreakdown | null>(null)
  const [series, setSeries] = useState<UsageSeriesPoint[] | null>(null)
  const [budget, setBudget] = useState<SpendBudget | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const days = parseUsageDays(searchParams.get('days'))
  const [capDraft, setCapDraft] = useState<{ tokens: string; usd: string } | null>(null)
  const [savingCaps, setSavingCaps] = useState(false)
  const [capError, setCapError] = useState<string | null>(null)
  const confirm = useConfirm()

  const fmtDay = (iso: string) => {
    if (!iso) return ''
    const date = new Date(`${iso}T12:00:00Z`)
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }

  const setDays = (next: string) => {
    const params = new URLSearchParams(searchParams)
    if (next === '30') params.delete('days')
    else params.set('days', next)
    setSearchParams(params, { replace: true })
  }

  const capBar = (label: string, period: SpendPeriodStatus, format: (value: number) => string) => (
    <CapBar
      label={label}
      value={
        period.cap
          ? t('usagePage.usedOfCap', { used: format(period.used), cap: format(period.cap) })
          : `${format(period.used)} ${t('usagePage.noCapParen')}`
      }
      ratio={period.cap ? period.ratio : null}
      exceeded={period.exceeded}
    />
  )

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    setError(null)
    Promise.all([
      bokitoGetCockpitSummary(token),
      bokitoGetUsageBreakdown(token, days),
      bokitoGetBudget(token),
      bokitoGetUsageSeries(token, { days }),
    ])
      .then(([s, b, bud, ser]) => {
        setSummary(s)
        setBreakdown(b)
        setBudget(bud)
        setSeries(ser.points)
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

  const saveCaps = useCallback(async () => {
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
      if (!(await confirm({ description: t('usagePage.confirmClearCaps'), destructive: true }))) {
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
  }, [token, capDraft, t, budget, confirm])

  const tokensValue = num(breakdown?.total_tokens ?? summary?.tokens_month ?? 0)
  const costValue = breakdown
    ? usd(breakdown.total_customer_cost_micros)
    : formatAppUsdCents(summary?.cost_cents_month ?? 0, locale)

  const timeBreakdown = summary?.time_saved_breakdown ?? []
  const timeMinutes = (key: string) =>
    timeBreakdown.find((row) => row.action === key)?.minutes ?? 0
  const timeSavedHint =
    summary && summary.time_saved_minutes_week > 0
      ? t('usagePage.timeSavedHint', {
          autonomous: `${num(timeMinutes('autonomous_reply'))} min`,
          drafts: `${num(timeMinutes('assisted_draft_unchanged') + timeMinutes('assisted_draft_edited'))} min`,
          other: `${num(timeMinutes('ticket_filed_by_agent') + timeMinutes('flow_run_completed'))} min`,
        })
      : t('usagePage.timeSavedEmptyHint')

  const outcomeStats = summary
    ? [
        {
          key: 'conversations',
          label: t('usagePage.conversations7d'),
          value: num(summary.volume_week),
          hint:
            summary.volume_week === 0
              ? (summary.open_backlog ?? 0) > 0
                ? t('usagePage.conversationsEmptyWithBacklog', { count: summary.open_backlog })
                : t('usagePage.conversationsEmptyHint')
              : (summary.open_backlog ?? 0) > 0
                ? t('usagePage.openBacklogHint', { count: summary.open_backlog })
                : null,
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
          hint: timeSavedHint,
          hintTo: summary.time_saved_minutes_week === 0 ? '/agents' : null,
          hintLink: summary.time_saved_minutes_week === 0 ? t('usagePage.openAgents') : null,
        },
        {
          key: 'feedback',
          label: t('usagePage.avgFeedback'),
          value:
            summary.avg_feedback_score > 0
              ? num(summary.avg_feedback_score)
              : t('usagePage.noScore', { defaultValue: '—' }),
          hint: summary.avg_feedback_score === 0 ? t('usagePage.feedbackEmptyHint') : null,
          hintTo: summary.avg_feedback_score === 0 ? '/ai/assistant' : null,
          hintLink: summary.avg_feedback_score === 0 ? t('usagePage.openWebsiteWidget') : null,
        },
        {
          key: 'csat',
          label: t('cockpitPage.csat'),
          value:
            summary.csat_score != null
              ? num(summary.csat_score)
              : t('usagePage.noScore', { defaultValue: '—' }),
          hint:
            summary.csat_score == null
              ? t('cockpitPage.noRatings')
              : t('cockpitPage.csatResponses', { count: summary.csat_responses }),
          hintTo: summary.csat_score == null ? '/ai/assistant' : null,
          hintLink: summary.csat_score == null ? t('usagePage.openWebsiteWidget') : null,
        },
        {
          key: 'decisions',
          label: t('usagePage.openDecisions'),
          value: num(summary.open_decisions),
          hint:
            summary.open_decisions > 0
              ? t('usagePage.openDecisionsHint')
              : t('usagePage.openDecisionsEmpty'),
          hintTo: forYouPath(),
          hintLink: t('usagePage.openForYou', { defaultValue: 'Open For you' }),
        },
      ]
    : []

  const periodControl = (
    <SegmentedControl
      size="sm"
      value={String(days)}
      onChange={setDays}
      options={([7, 30, 90] as const).map((value) => ({
        value: String(value),
        label: t(`usagePage.period${value}` as 'usagePage.period7'),
      }))}
    />
  )

  return (
    <div>
      <ContentHeader
        title={workspaceBrandName(currentWorkspace)}
        subtitle={t('pageHeaders.cockpitUsage')}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceIdHint />
            {refreshedAt ? (
              <span className="text-xs text-text-muted">
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
                className="rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('usagePage.exportCsv')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {t('usagePage.refresh')}
            </button>
          </div>
        }
      />

      <CockpitTabs />

      {error ? (
        <div className="mb-4 space-y-2">
          <ApiErrorBanner message={error} onRetry={load} />
          {!summary ? (
            <div className="rounded-lg border border-dashed border-border/60 px-4 py-3">
              <p className="text-xs text-text-muted">{t('usagePage.errorRecoveryHint')}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                <Link to="/communication/new" className="text-xs font-medium text-accent hover:underline">
                  {t('usagePage.startChat')}
                </Link>
                <Link to="/agents" className="text-xs font-medium text-accent hover:underline">
                  {t('usagePage.openAgents')}
                </Link>
                <Link to="/settings/setup" className="text-xs font-medium text-accent hover:underline">
                  {t('usagePage.openSetup')}
                </Link>
                <Link to="/settings/models" className="text-xs font-medium text-accent hover:underline">
                  {t('usagePage.openModels')}
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {budget?.status.blocked ? (
        <Callout tone="error" title={t('usagePage.budgetBlocked')} className="mb-4" />
      ) : null}

      <div className="space-y-5">
        <section className="panel overflow-hidden" data-testid="usage-token-series">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-text-heading">{t('usagePage.seriesTitle')}</h2>
              <p className="mt-0.5 text-xs text-text-muted">{t('usagePage.seriesHint', { days })}</p>
            </div>
            {periodControl}
          </div>
          <div className="p-4">
            {series ? (
              <div className="grid items-stretch gap-4 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2" style={{ height: CHART_HEIGHT }}>
                  <Chart
                    kind="area"
                    tone="ai"
                    height={CHART_HEIGHT}
                    ariaLabel={t('usagePage.seriesAria', { days })}
                    emptyLabel={t('usagePage.seriesEmpty')}
                    series={[
                      {
                        name: t('usagePage.seriesName'),
                        points: series.map((point) => ({
                          x: fmtDay(point.date ?? ''),
                          y: point.tokens,
                        })),
                      },
                    ]}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-1" style={{ minHeight: CHART_HEIGHT }}>
                  <KpiInset label={t('usagePage.tokens30d', { days })} value={tokensValue} />
                  <KpiInset label={t('usagePage.cost30d', { days })} value={costValue} />
                </div>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-text-muted">{t('usagePage.loading')}</p>
            )}
          </div>
        </section>

        {budget ? (
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-text-heading">{t('usagePage.budgetTitle')}</h2>
                <p className="mt-0.5 text-xs text-text-muted">{t('usagePage.capsHint')}</p>
              </div>
              {capDraft ? null : (
                <button
                  type="button"
                  onClick={startEditCaps}
                  className="shrink-0 rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
                >
                  {t('usagePage.editCaps')}
                </button>
              )}
            </div>
            <div className="p-4">
              <div className="grid gap-4 md:grid-cols-2">
                {capBar(t('usagePage.tokensToday'), budget.status.daily_tokens, num)}
                {capBar(t('usagePage.spendMonth'), budget.status.monthly_customer_micros, usd)}
              </div>
              {capDraft ? (
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border/60 pt-3">
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    {t('usagePage.dailyCap')}
                    <input
                      value={capDraft.tokens}
                      onChange={(e) => setCapDraft({ ...capDraft, tokens: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void saveCaps()
                        }
                      }}
                      placeholder={t('usagePage.noCap')}
                      inputMode="numeric"
                      className="w-36 rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    {t('usagePage.monthlyCap')}
                    <input
                      value={capDraft.usd}
                      onChange={(e) => setCapDraft({ ...capDraft, usd: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void saveCaps()
                        }
                      }}
                      placeholder={t('usagePage.noCap')}
                      inputMode="decimal"
                      className="w-36 rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveCaps()}
                      disabled={savingCaps}
                      className="rounded-md border border-border-light bg-bg-hover px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60"
                    >
                      {savingCaps ? t('usagePage.saving') : t('usagePage.save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCapDraft(null)}
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
                    >
                      {t('usagePage.cancel')}
                    </button>
                  </div>
                  {capError ? <p className="w-full text-xs text-status-error">{capError}</p> : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {outcomeStats.length > 0 ? (
          <section className="panel overflow-hidden">
            <div className="border-b border-border/60 px-4 py-3">
              <h2 className="text-base font-semibold text-text-heading">{t('usagePage.outcomesTitle')}</h2>
              <p className="mt-0.5 text-xs text-text-muted">{t('usagePage.outcomesHint')}</p>
            </div>
            <div className="p-4">
              <StatGrid className="grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3">
                {outcomeStats.map((stat) => (
                  <StatTile
                    key={stat.key}
                    label={stat.label}
                    value={stat.value}
                    hint={
                      stat.hint ? (
                        <span className="leading-snug">
                          {stat.hint}
                          {stat.hintTo && stat.hintLink ? (
                            <>
                              {' '}
                              <Link to={stat.hintTo} className="font-medium text-accent hover:underline">
                                {stat.hintLink}
                              </Link>
                            </>
                          ) : null}
                        </span>
                      ) : null
                    }
                  />
                ))}
              </StatGrid>
            </div>
          </section>
        ) : !summary && !error ? (
          <p className="px-1 py-6 text-sm text-text-muted">{t('usagePage.loading')}</p>
        ) : null}

        {breakdown ? (
          <div>
            <div className="mb-3 px-0.5">
              <h2 className="text-base font-semibold text-text-heading">{t('usagePage.breakdownTitle')}</h2>
              <p className="mt-0.5 text-xs text-text-muted">{t('usagePage.breakdownHint', { days })}</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <UsageCard
                title={t('usagePage.byModel', { days: breakdown.days })}
                extra={t('usagePage.billable', { amount: usd(breakdown.total_customer_cost_micros) })}
              >
                {breakdown.by_model.length === 0 ? (
                  <div>
                    <p className="text-xs text-text-muted">{t('usagePage.noModelUsage')}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      <Link to="/communication/new" className="text-xs font-medium text-accent hover:underline">
                        {t('usagePage.startChat')}
                      </Link>
                      <Link to="/agents" className="text-xs font-medium text-accent hover:underline">
                        {t('usagePage.openAgents')}
                      </Link>
                      <Link to="/settings/setup" className="text-xs font-medium text-accent hover:underline">
                        {t('usagePage.openSetup')}
                      </Link>
                      <Link to="/settings/models" className="text-xs font-medium text-accent hover:underline">
                        {t('usagePage.openModels')}
                      </Link>
                    </div>
                  </div>
                ) : (
                  breakdown.by_model.map((row) => (
                    <Link
                      key={`${row.model}-${row.key_source}`}
                      to="/settings/models"
                      className={usageLink}
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <ModelIcon slug={row.model} provider={row.provider} size={18} className="mt-0.5" />
                        <div className="min-w-0">
                          <p className="truncate-fade font-medium text-text-primary">
                            {humanizeModelId(row.model) || t('usagePage.unknown')}
                          </p>
                          <p className="text-xs text-text-muted">
                            {t('usagePage.tokens', { count: num(row.tokens) })} ·{' '}
                            {row.billable ? (
                              <span className="text-status-warning">
                                {t('usagePage.billableRow', { amount: usd(row.customer_cost_micros) })}
                              </span>
                            ) : (
                              <span className="text-status-success">{t('usagePage.byok')}</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </UsageCard>

              <UsageCard title={t('usagePage.byAgent', { days: breakdown.days })}>
                {breakdown.by_agent.length === 0 ? (
                  <div>
                    <p className="text-xs text-text-muted">{t('usagePage.noAgentUsage')}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      <Link to="/agents" className="text-xs font-medium text-accent hover:underline">
                        {t('usagePage.openAgents')}
                      </Link>
                      <Link to="/communication/new" className="text-xs font-medium text-accent hover:underline">
                        {t('usagePage.startChat')}
                      </Link>
                      <Link to="/settings/setup" className="text-xs font-medium text-accent hover:underline">
                        {t('usagePage.openSetup')}
                      </Link>
                      <Link to="/settings/models" className="text-xs font-medium text-accent hover:underline">
                        {t('usagePage.openModels')}
                      </Link>
                    </div>
                  </div>
                ) : (
                  breakdown.by_agent.map((row) => {
                    const body = (
                      <>
                        <p className="min-w-0 truncate-fade font-medium text-text-primary">{row.agent_name}</p>
                        <p className="shrink-0 text-xs text-text-muted">
                          {t('usagePage.tokensShort', { count: num(row.tokens) })} · {usd(row.customer_cost_micros)}
                        </p>
                      </>
                    )
                    return row.agent_id ? (
                      <Link key={row.agent_id} to={`/agents/${row.agent_id}`} className={usageLink}>
                        {body}
                      </Link>
                    ) : (
                      <div key="system" className={usageRow}>
                        {body}
                      </div>
                    )
                  })
                )}
              </UsageCard>

              <UsageCard title={t('usagePage.byUser', { days: breakdown.days })} hint={t('usagePage.userHint')}>
                {(breakdown.by_user ?? []).length === 0 ? (
                  <div>
                    <p className="text-xs text-text-muted">{t('usagePage.noUserUsage')}</p>
                    <Link
                      to="/communication/new"
                      className="mt-2 inline-block text-xs font-medium text-accent hover:underline"
                    >
                      {t('usagePage.startChat')}
                    </Link>
                    <Link
                      to="/settings/setup"
                      className="mt-2 ml-3 inline-block text-xs font-medium text-accent hover:underline"
                    >
                      {t('usagePage.openSetup')}
                    </Link>
                  </div>
                ) : (
                  (breakdown.by_user ?? []).map((row) => (
                    <div key={row.user_id ?? 'system'} className={usageRow}>
                      <p className="min-w-0 truncate-fade font-medium text-text-primary">
                        {isSystemUsageName(row.user_name) ? t('usagePage.systemUser') : row.user_name}
                      </p>
                      <p className="shrink-0 text-xs text-text-muted">
                        {t('usagePage.tokensShort', { count: num(row.tokens) })} · {usd(row.customer_cost_micros)}
                      </p>
                    </div>
                  ))
                )}
              </UsageCard>

              <UsageCard title={t('usagePage.byRegion', { days: breakdown.days })} hint={t('usagePage.euShareHint')}>
                {(breakdown.by_region ?? []).length === 0 ? (
                  <p className="text-xs text-text-muted">{t('usagePage.noRegionUsage')}</p>
                ) : (
                  (breakdown.by_region ?? []).map((row) => (
                    <Link key={row.region} to="/settings/trust" className={usageLink}>
                      <RegionBadge region={row.region} />
                      <p className="shrink-0 text-xs text-text-muted">
                        {t('usagePage.tokensShort', { count: num(row.tokens) })} · {usd(row.customer_cost_micros)}
                      </p>
                    </Link>
                  ))
                )}
              </UsageCard>
            </div>
          </div>
        ) : null}

        <p className="text-xs text-text-muted">{t('usagePage.byokFooter')}</p>
      </div>
    </div>
  )
}
