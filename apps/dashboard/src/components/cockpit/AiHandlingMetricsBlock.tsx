import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { AI_HANDLING_SETTINGS_PATH } from '../ai/AiHandlingPicker'
import { getAiHandlingMetrics, type AiHandlingMetrics } from '../../lib/ai-handling-api'
import { bokitoGetUsageSeries, type UsageSeriesPoint } from '../../lib/bokito-api'
import { Chart, InsetPanel } from '../ui'

const CHART_DAYS = 30

/** Token sparkline: shape only, no vertical quantity labels. */
function TokenActivityChart({ points }: { points: UsageSeriesPoint[] }) {
  const { t, i18n } = useTranslation('common')
  const fmt = (iso: string | undefined) => {
    if (!iso) return ''
    const date = new Date(`${iso}T12:00:00Z`)
    return date.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })
  }
  const first = points[0]?.date
  const last = points[points.length - 1]?.date

  return (
    <div className="min-w-0">
      <Chart
        kind="area"
        showAxes={false}
        height={96}
        ariaLabel={t('aiHandling.metrics.chartAria', { days: points.length || CHART_DAYS })}
        emptyLabel={t('aiHandling.metrics.emptyChart')}
        series={[
          {
            name: t('aiHandling.metrics.activityTitle'),
            points: points.map((point) => ({ x: fmt(point.date), y: point.tokens })),
          },
        ]}
      />
      {points.length > 0 ? (
        <div className="mt-2 flex justify-between text-2xs tabular-nums text-text-muted">
          <span>{fmt(first)}</span>
          <span>{fmt(last)}</span>
        </div>
      ) : null}
    </div>
  )
}

/** Overview AI activity: token chart plus open Autonomous / Assisted counts. */
export default function AiHandlingMetricsBlock() {
  const { t } = useTranslation('common')
  const { token } = useAuth()
  const [metrics, setMetrics] = useState<AiHandlingMetrics | null>(null)
  const [points, setPoints] = useState<UsageSeriesPoint[] | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void Promise.all([
      getAiHandlingMetrics(token, CHART_DAYS),
      bokitoGetUsageSeries(token, CHART_DAYS),
    ])
      .then(([nextMetrics, series]) => {
        if (cancelled) return
        setMetrics(nextMetrics)
        setPoints(series.points)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  if (!metrics || !points) return null

  const modes = ['autonomous', 'assisted'] as const

  return (
    <section className="panel overflow-hidden" data-testid="overview-ai-activity">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-heading">{t('aiHandling.metrics.activityTitle')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {t('aiHandling.metrics.activityHint', { days: metrics.days })}
          </p>
        </div>
        <Link to={AI_HANDLING_SETTINGS_PATH} className="link-draw shrink-0 pt-0.5 text-xs font-medium text-accent">
          {t('aiHandling.openSettings')}
        </Link>
      </div>
      <div className="grid items-center gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <div className="grid grid-cols-2 gap-2">
          {modes.map((mode) => (
            <InsetPanel key={mode} padding="sm" className="px-3 py-3">
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
        <TokenActivityChart points={points} />
      </div>
    </section>
  )
}
