import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { AI_HANDLING_SETTINGS_PATH } from '../ai/AiHandlingPicker'
import { AI_HANDLING_MODES } from '../../lib/ai-handling'
import { getAiHandlingMetrics, type AiHandlingMetrics } from '../../lib/ai-handling-api'

function percent(value: number | null): string {
  return value == null ? '-' : `${Math.round(value * 100)}%`
}

/** Overview strip: open conversations per AI handling mode plus outcome rates. */
export default function AiHandlingMetricsBlock() {
  const { t } = useTranslation('common')
  const { token } = useAuth()
  const [metrics, setMetrics] = useState<AiHandlingMetrics | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void getAiHandlingMetrics(token)
      .then((next) => {
        if (!cancelled) setMetrics(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  if (!metrics) return null

  return (
    <section
      className="rounded-lg border border-border/60 bg-bg-surface p-4"
      data-testid="overview-ai-handling"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-heading">{t('aiHandling.title')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t('aiHandling.metrics.hint', { days: metrics.days })}</p>
        </div>
        <Link to={AI_HANDLING_SETTINGS_PATH} className="link-draw text-xs font-medium text-accent">
          {t('aiHandling.openSettings')}
        </Link>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {AI_HANDLING_MODES.map((mode) => (
          <div key={mode} className="rounded-md border border-border/50 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <AiHandlingIcon mode={mode} size={12} />
              {t(`aiHandling.modes.${mode}.label`)}
            </span>
            <span className="mt-0.5 block tabular-nums text-base font-semibold text-text-heading">
              {metrics.openByMode[mode]}
            </span>
          </div>
        ))}
        <div className="rounded-md border border-border/50 px-3 py-2">
          <span className="block text-xs text-text-muted">{t('aiHandling.metrics.autonomousReplies')}</span>
          <span className="mt-0.5 block tabular-nums text-base font-semibold text-text-heading">
            {metrics.autonomousReplies}
          </span>
        </div>
        <div className="rounded-md border border-border/50 px-3 py-2">
          <span className="block text-xs text-text-muted">{t('aiHandling.metrics.handoffRate')}</span>
          <span className="mt-0.5 block tabular-nums text-base font-semibold text-text-heading">
            {percent(metrics.handoffRate)}
          </span>
        </div>
        <div className="rounded-md border border-border/50 px-3 py-2">
          <span className="block text-xs text-text-muted">{t('aiHandling.metrics.editRate')}</span>
          <span className="mt-0.5 block tabular-nums text-base font-semibold text-text-heading">
            {percent(metrics.assistedEditRate)}
          </span>
        </div>
      </div>
    </section>
  )
}
