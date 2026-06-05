import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listMessages, type MessageRow } from '../../lib/messages-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { WorkforceDecisionList } from '../workforce/WorkforceDecisionList'

type DecisionsInlineProps = {
  /** When set, only decisions for this project are shown. Omit for workspace-wide. */
  projectId?: string
  /** Show project label + link above each decision (workspace-wide view). */
  showProjectContext?: boolean
  projectNameById?: Map<string, string>
  /** Called after a decision is approved/rejected/deferred so the canvas can refresh. */
  onResolved?: () => void
}

export default function DecisionsInline({
  projectId,
  showProjectContext = false,
  projectNameById,
  onResolved,
}: DecisionsInlineProps) {
  const { t } = useTranslation('aios')
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listMessages({ status: 'awaiting_human', ...(projectId ? { project_id: projectId } : {}) })
      setMessages(rows)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const handleRefresh = useCallback(async () => {
    await load()
    onResolved?.()
  }, [load, onResolved])

  if (loading) {
    return <p className="text-xs text-text-muted">{t('panel.decisions.loading')}</p>
  }
  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-status-error">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-medium text-accent hover:underline"
        >
          {t('actions.retry')}
        </button>
      </div>
    )
  }
  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 px-3 py-4 text-center text-xs text-text-muted">
        {t('panel.decisions.empty')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <WorkforceDecisionList
        messages={messages}
        onRefresh={handleRefresh}
        showProjectContext={showProjectContext}
        projectNameById={projectNameById}
      />
    </div>
  )
}
