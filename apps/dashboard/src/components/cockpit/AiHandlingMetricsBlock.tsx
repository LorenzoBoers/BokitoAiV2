import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { AI_HANDLING_SETTINGS_PATH } from '../ai/AiHandlingPicker'
import { getAiHandlingMetrics, type AiHandlingMetrics } from '../../lib/ai-handling-api'
import { bokitoGetCockpitSummary, type ActionMixDay, type CockpitSummary } from '../../lib/bokito-api'
import { Chart, InsetPanel } from '../ui'
import type { AiHandlingMode } from '../../lib/ai-handling'

const CHART_DAYS = 14
const METRICS_DAYS = 30
const CHART_HEIGHT = 188
const PIE_HEIGHT = 168

const AI_COLOR = 'rgb(var(--color-ai))'
const MANUAL_COLOR = 'rgb(var(--color-text-muted))'

const MODE_ORDER: AiHandlingMode[] = ['autonomous', 'assisted', 'manual']

const MODE_SLICE_COLOR: Record<AiHandlingMode, string> = {
  autonomous: AI_COLOR,
  assisted: AI_COLOR,
  manual: MANUAL_COLOR,
}

function formatDay(iso: string | undefined, language: string) {
  if (!iso) return ''
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return ''
  const date = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(language, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function hasSeriesWork(points: ActionMixDay[]) {
  return points.some((point) => point.ai_minutes > 0 || point.manual_minutes > 0)
}

type PeriodMix = { aiMinutes: number; manualMinutes: number; aiCount: number; manualCount: number }

function sumPeriod(points: ActionMixDay[]): PeriodMix {
  return points.reduce(
    (acc, point) => ({
      aiMinutes: acc.aiMinutes + point.ai_minutes,
      manualMinutes: acc.manualMinutes + point.manual_minutes,
      aiCount: acc.aiCount + (point.ai_count ?? 0),
      manualCount: acc.manualCount + (point.manual_count ?? 0),
    }),
    { aiMinutes: 0, manualMinutes: 0, aiCount: 0, manualCount: 0 },
  )
}

/** Share of actions (counts, else minutes) handled by AI. */
export function aiSharePercent(period: PeriodMix): number | null {
  const actions = period.aiCount + period.manualCount
  if (actions > 0) return (period.aiCount / actions) * 100
  const minutes = period.aiMinutes + period.manualMinutes
  if (minutes > 0) return (period.aiMinutes / minutes) * 100
  return null
}

/** Relative change in percent. New activity against an empty baseline counts as +100. */
export function relativeChangePct(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null
  return ((current - previous) / previous) * 100
}

function splitWeekPeriods(points: ActionMixDay[]): { current: PeriodMix; previous: PeriodMix | null } {
  if (points.length >= 14) {
    return { previous: sumPeriod(points.slice(0, 7)), current: sumPeriod(points.slice(-7)) }
  }
  return { previous: null, current: sumPeriod(points.slice(-7)) }
}

function PeriodTrend({ delta, label }: { delta: number | null; label: string }) {
  if (delta == null || !Number.isFinite(delta)) return null
  const rounded = Math.round(delta)
  if (rounded === 0) {
    return (
      <span className="text-sm tabular-nums text-text-muted" title={label}>
        0%
      </span>
    )
  }
  const up = rounded > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-sm font-medium tabular-nums ${
        up ? 'text-status-success' : 'text-status-error'
      }`}
      title={label}
      aria-label={`${label}: ${up ? '+' : ''}${rounded}%`}
    >
      <Icon size={14} strokeWidth={2.4} aria-hidden />
      {up ? '+' : ''}
      {rounded}%
    </span>
  )
}

/** Overview AI activity: AI vs manual area over time, plus the weekly mix pie. */
export default function AiHandlingMetricsBlock() {
  const { t, i18n } = useTranslation('common')
  const { token } = useAuth()
  const [metrics, setMetrics] = useState<AiHandlingMetrics | null>(null)
  const [summary, setSummary] = useState<CockpitSummary | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void Promise.all([getAiHandlingMetrics(token, METRICS_DAYS), bokitoGetCockpitSummary(token)])
      .then(([nextMetrics, cockpit]) => {
        if (cancelled) return
        setMetrics(nextMetrics)
        setSummary(cockpit)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  const points = summary?.action_mix_series ?? []
  const mixByMode = useMemo(() => {
    const map = new Map<string, { count: number; minutes: number }>()
    for (const row of summary?.action_mix ?? []) {
      map.set(row.mode, { count: row.count, minutes: row.minutes })
    }
    return MODE_ORDER.map((mode) => ({
      mode,
      count: map.get(mode)?.count ?? 0,
      minutes: map.get(mode)?.minutes ?? 0,
    }))
  }, [summary?.action_mix])

  const pieSlices = useMemo(
    () =>
      mixByMode
        .filter((row) => row.minutes > 0 || row.count > 0)
        .map((row) => ({
          name: t(`aiHandling.modes.${row.mode}.label`),
          value: row.minutes > 0 ? row.minutes : row.count,
          color: MODE_SLICE_COLOR[row.mode],
        })),
    [mixByMode, t],
  )

  const chartPoints = useMemo(
    () =>
      points.map((point) => ({
        x: formatDay(point.date, i18n.language),
        ai: point.ai_minutes,
        manual: point.manual_minutes,
      })),
    [i18n.language, points],
  )

  const weeks = useMemo(() => splitWeekPeriods(points), [points])
  const mixShare = useMemo(() => {
    const period = {
      aiMinutes: mixByMode.filter((row) => row.mode !== 'manual').reduce((sum, row) => sum + row.minutes, 0),
      manualMinutes: mixByMode.find((row) => row.mode === 'manual')?.minutes ?? 0,
      aiCount: mixByMode.filter((row) => row.mode !== 'manual').reduce((sum, row) => sum + row.count, 0),
      manualCount: mixByMode.find((row) => row.mode === 'manual')?.count ?? 0,
    }
    return aiSharePercent(period)
  }, [mixByMode])

  if (!metrics || !summary) return null

  const first = points[0]?.date
  const last = points[points.length - 1]?.date
  const mid = points[Math.floor(points.length / 2)]?.date
  const aiLabel = t('aiHandling.metrics.seriesAi')
  const manualLabel = t('aiHandling.metrics.seriesManual')
  const trendLabel = t('aiHandling.metrics.trendVsPrevious')
  const timeSavedTrend = weeks.previous
    ? relativeChangePct(summary.time_saved_minutes_week, weeks.previous.aiMinutes)
    : relativeChangePct(summary.time_saved_minutes_week, 0)
  const aiShareTrend =
    mixShare == null
      ? null
      : mixShare - (weeks.previous ? (aiSharePercent(weeks.previous) ?? 0) : 0)
  const shownShare = mixShare ?? aiSharePercent(weeks.current)

  return (
    <section className="panel overflow-hidden" data-testid="overview-ai-activity">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-heading">{t('aiHandling.metrics.activityTitle')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {t('aiHandling.metrics.activityHint', { days: CHART_DAYS })}
          </p>
        </div>
        <Link to={AI_HANDLING_SETTINGS_PATH} className="link-draw shrink-0 pt-0.5 text-xs font-medium text-accent">
          {t('aiHandling.openSettings')}
        </Link>
      </div>
      <div className="p-4">
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-3 lg:col-span-2">
            <div className="grid grid-cols-2 gap-2">
              <InsetPanel padding="sm" className="px-3 py-3">
                <span className="block text-xs text-text-muted" title={t('aiHandling.metrics.timeSavedHint')}>
                  {t('aiHandling.metrics.timeSaved')}
                </span>
                <span className="mt-1 flex items-baseline gap-2">
                  <span className="tabular-nums text-2xl font-semibold text-text-heading">
                    {summary.time_saved_minutes_week} min
                  </span>
                  <PeriodTrend delta={timeSavedTrend} label={trendLabel} />
                </span>
              </InsetPanel>
              <InsetPanel padding="sm" className="px-3 py-3">
                <span className="block text-xs text-text-muted" title={t('aiHandling.metrics.aiShareHint')}>
                  {t('aiHandling.metrics.aiShare')}
                </span>
                <span className="mt-1 flex items-baseline gap-2">
                  <span className="tabular-nums text-2xl font-semibold text-text-heading">
                    {shownShare == null ? '—' : `${Math.round(shownShare)}%`}
                  </span>
                  <PeriodTrend delta={aiShareTrend} label={trendLabel} />
                </span>
              </InsetPanel>
            </div>
            <Chart
              kind="area"
              stack
              showAxes={false}
              tone="ai"
              height={CHART_HEIGHT}
              ariaLabel={t('aiHandling.metrics.chartAria', { days: points.length || CHART_DAYS })}
              emptyLabel={t('aiHandling.metrics.emptyChart')}
              series={
                hasSeriesWork(points)
                  ? [
                      {
                        name: manualLabel,
                        color: MANUAL_COLOR,
                        points: chartPoints.map((point) => ({ x: point.x, y: point.manual })),
                      },
                      {
                        name: aiLabel,
                        color: AI_COLOR,
                        points: chartPoints.map((point) => ({ x: point.x, y: point.ai })),
                      },
                    ]
                  : []
              }
            />
            {points.length > 0 ? (
              <div className="flex justify-between text-2xs tabular-nums text-text-muted">
                <span>{formatDay(first, i18n.language)}</span>
                <span>{formatDay(mid, i18n.language)}</span>
                <span>{formatDay(last, i18n.language)}</span>
              </div>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col items-stretch gap-2 lg:pt-0.5">
            <Chart
              kind="pie"
              height={PIE_HEIGHT}
              tone="ai"
              slices={pieSlices}
              ariaLabel={t('aiHandling.metrics.mixAria')}
              emptyLabel={t('aiHandling.metrics.emptyMix')}
            />
            <ul className="space-y-1">
              {mixByMode.map((row) => (
                <li key={row.mode} className="flex items-center gap-2 text-2xs text-text-muted">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: MODE_SLICE_COLOR[row.mode] }}
                    aria-hidden
                  />
                  <AiHandlingIcon mode={row.mode} size={12} />
                  <span className="min-w-0 flex-1 truncate">{t(`aiHandling.modes.${row.mode}.label`)}</span>
                  <span className="tabular-nums text-text-secondary" title={t('aiHandling.metrics.mixWeightHint')}>
                    {row.count}
                    {row.minutes > 0 ? ` · ${row.minutes}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-2xs text-text-muted">
              {t('aiHandling.metrics.openHint', {
                autonomous: metrics.openByMode.autonomous,
                assisted: metrics.openByMode.assisted,
              })}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
