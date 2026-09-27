import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { useLlmRuntime } from '../../hooks/useLlmRuntime'

/**
 * Workspace-wide notice when AI runs without a live model key.
 * Mock replies are placeholders and must not be read as customer delivery.
 */
export default function MockAiBanner() {
  const { t } = useTranslation('nav')
  const { live, loading, error } = useLlmRuntime()

  if (loading || error || live) return null

  return (
    <div className="flex items-center gap-3 border-b border-status-warning/30 bg-status-warning/10 px-4 py-1.5 text-[13px] text-text-primary">
      <AlertTriangle size={14} className="shrink-0 text-status-warning" />
      <span className="min-w-0 truncate">{t('mockAiBanner.body')}</span>
      <Link
        to="/settings/models"
        className="ml-auto shrink-0 rounded-md border border-border/60 px-2.5 py-0.5 font-medium text-text-heading transition-colors hover:bg-bg-hover"
      >
        {t('mockAiBanner.cta')}
      </Link>
    </div>
  )
}
