import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { AI_HANDLING_SETTINGS_PATH } from '../ai/AiHandlingPicker'
import { getAiHandlingMetrics, type AiHandlingMetrics } from '../../lib/ai-handling-api'
import {
  bokitoGetCockpitSummary,
  bokitoGetUsageSeries,
  type CockpitSummary,
  type UsageSeriesPoint,
} from '../../lib/bokito-api'
import { Chart, InsetPanel } from '../ui'
import type { AiHandlingMode } from '../../lib/ai-handling'

const CHART_HOURS = 24
const METRICS_DAYS = 30
/** Token area fills the left column under the two KPI cards. */
const CHART_HEIGHT = 188
/** Donut sized for the right third of the row. */
const PIE_HEIGHT = 168

const MODE_ORDER: AiHandlingMode[] = ['autonomous', 'assisted', 'manual']

const MODE_SLICE_COLOR: Record<AiHandlingMode, string> = {
  autonomous: 'rgb(var(--color-ai))',
  assisted: 'rgb(var(--color-ai))',
  manual: 'rgb(var(--color-text-muted))',
}

function formatHour(iso: string | undefined, language: string) {
  if (!iso) return ''
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
}

/** Overview AI activity: last-24h token chart plus weighted action mix pie. */
export default function AiHandlingMetricsBlock() {
  const { t, i18n } = useTranslation('common')
  const { token } = useAuth()
  const [metrics, setMetrics] = useState<AiHandlingMetrics | null>(null)
  const [points, setPoints] = useState<UsageSeriesPoint[] | null>(null)
  const [summary, setSummary] = useState<CockpitSummary | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void Promise.all([
      getAiHandlingMetrics(token, METRICS_DAYS),
      bokitoGetUsageSeries(token, { hours: CHART_HOURS }),
      bokitoGetCockpitSummary(token),
    ])
      .then(([nextMetrics, series, cockpit]) => {
        if (cancelled) return
        setMetrics(nextMetrics)
        setPoints(series.points)
        setSummary(cockpit)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

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
          // Prefer weighted minutes for slice size; fall back to raw counts.
          value: row.minutes > 0 ? row.minutes : row.count,
          color: MODE_SLICE_COLOR[row.mode],
        })),
    [mixByMode, t],
  )

  if (!metrics || !points) return null

  const first = points[0]?.at
  const last = points[points.length - 1]?.at
  const mid = points[Math.floor(points.length / 2)]?.at

  return (
    <section className="panel overflow-hidden" data-testid="overview-ai-activity">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-heading">{t('aiHandling.metrics.activityTitle')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {t('aiHandling.metrics.activityHint', { hours: CHART_HOURS })}
          </p>
        </div>
        <Link to={AI_HANDLING_SETTINGS_PATH} className="link-draw shrink-0 pt-0.5 text-xs font-medium text-accent">
          {t('aiHandling.openSettings')}
        </Link>
      </div>
      <div className="p-4">
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-3 lg:col-span-2">
            {summary ? (
              <div className="grid grid-cols-2 gap-2">
                <InsetPanel padding="sm" className="px-3 py-3">
                  <span className="block text-xs text-text-muted" title={t('aiHandling.metrics.timeSavedHint')}>
                    {t('aiHandling.metrics.timeSaved')}
                  </span>
                  <span className="mt-1 block tabular-nums text-2xl font-semibold text-text-heading">
                    {summary.time_saved_minutes_week} min
                  </span>
                </InsetPanel>
                <InsetPanel padding="sm" className="px-3 py-3">
                  <span className="block text-xs text-text-muted" title={t('aiHandling.metrics.resolvedHint')}>
                    {t('aiHandling.metrics.resolved')}
                  </span>
                  <span className="mt-1 block tabular-nums text-2xl font-semibold text-text-heading">
                    {summary.resolved_conversations_week ?? 0}
                  </span>
                </InsetPanel>
              </div>
            ) : null}
            <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
              <div className="absolute inset-0">
                <Chart
                  kind="area"
                  showAxes={false}
                  tone="ai"
                  height="100%"
                  ariaLabel={t('aiHandling.metrics.chartAria', { hours: points.length || CHART_HOURS })}
                  emptyLabel={t('aiHandling.metrics.emptyChart')}
                  series={[
                    {
                      name: t('aiHandling.metrics.activityTitle'),
                      points: points.map((point) => ({
                        x: formatHour(point.at, i18n.language),
                        y: point.tokens,
                      })),
                    },
                  ]}
                />
              </div>
            </div>
            {points.length > 0 ? (
              <div className="flex justify-between text-2xs tabular-nums text-text-muted">
                <span>{formatHour(first, i18n.language)}</span>
                <span>{formatHour(mid, i18n.language)}</span>
                <span>{formatHour(last, i18n.language)}</span>
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
