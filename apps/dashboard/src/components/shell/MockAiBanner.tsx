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
    <div className="flex h-8 items-center gap-2 border-b border-border/60 bg-bg px-3 text-xs text-text-secondary">
      <AlertTriangle size={14} className="shrink-0 text-status-warning" />
      <span className="min-w-0 truncate-fade">{t('mockAiBanner.body')}</span>
      <Link
        to="/settings/models"
        className="ml-auto shrink-0 h-6 rounded-md border border-border/70 px-2 text-xs font-medium text-text-heading transition-colors hover:bg-bg-hover"
      >
        {t('mockAiBanner.cta')}
      </Link>
    </div>
  )
}
