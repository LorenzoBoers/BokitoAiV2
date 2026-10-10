import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { AI_HANDLING_SETTINGS_PATH } from '../ai/AiHandlingPicker'
import { getAiHandlingMetrics, type AiHandlingMetrics } from '../../lib/ai-handling-api'
import { bokitoGetCockpitSummary, bokitoGetUsageSeries, type CockpitSummary, type UsageSeriesPoint } from '../../lib/bokito-api'
import { Chart, InsetPanel } from '../ui'

const CHART_HOURS = 24
const METRICS_DAYS = 30
const CHART_HEIGHT = 96

function formatHour(iso: string | undefined, language: string) {
  if (!iso) return ''
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
}

/** Overview AI activity: last-24h token chart plus open Autonomous / Assisted counts. */
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

  if (!metrics || !points) return null

  const modes = ['autonomous', 'assisted'] as const
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
        {summary ? (
          <div className="mb-4 grid grid-cols-2 gap-2">
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
        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2" style={{ height: CHART_HEIGHT }}>
            <Chart
              kind="area"
              showAxes={false}
              tone="ai"
              height={CHART_HEIGHT}
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
          <div className="grid grid-cols-2 gap-2" style={{ minHeight: CHART_HEIGHT }}>
            {modes.map((mode) => (
              <InsetPanel key={mode} padding="sm" className="flex h-full flex-col justify-center px-3 py-3">
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
                  <AiHandlingIcon mode={mode} size={14} />
                  <span className="truncate">{t(`aiHandling.modes.${mode}.label`)}</span>
                </span>
                <span className="mt-1 block tabular-nums text-2xl font-semibold text-text-heading">
                  {metrics.openByMode[mode]}
                </span>
              </InsetPanel>
            ))}
          </div>
        </div>
        {points.length > 0 ? (
          <div className="mt-2 grid gap-4 lg:grid-cols-3">
            <div className="flex justify-between text-2xs tabular-nums text-text-muted lg:col-span-2">
              <span>{formatHour(first, i18n.language)}</span>
              <span>{formatHour(mid, i18n.language)}</span>
              <span>{formatHour(last, i18n.language)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
