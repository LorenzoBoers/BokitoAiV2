import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Square, MessageSquarePlus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { cancelWorkbenchJob, followUpWorkbenchJob } from '../../lib/workbench-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { useConfirm } from '../ui/confirm-dialog'
import { cn } from '../../lib/utils'

const ACTIVE = new Set(['queued', 'running', 'needs_input', 'started', 'progress'])

type Props = {
  jobId: string
  provider?: string
  kind?: string
  className?: string
}

export function WorkbenchJobCard({ jobId, provider, kind, className }: Props) {
  const { t } = useTranslation('communication')
  const confirm = useConfirm()
  const { token } = useAuth()
  const [busy, setBusy] = useState<'follow' | 'stop' | null>(null)
  const [stopped, setStopped] = useState(false)

  const terminal = kind === 'finished' || kind === 'failed' || kind === 'cancelled' || stopped
  const showActions = !terminal && (ACTIVE.has(kind || '') || !kind)

  if (!showActions && !terminal) return null
  if (terminal && kind !== 'needs_input') return null

  const onFollowUp = async () => {
    if (!token || busy) return
    const text = window.prompt(t('timeline.workbench.followUpPrompt'))
    if (!text?.trim()) return
    setBusy('follow')
    try {
      await followUpWorkbenchJob(token, jobId, text.trim())
      toast.success(t('timeline.workbench.followUpSent'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('timeline.workbench.followUpError')))
    } finally {
      setBusy(null)
    }
  }

  const onStop = async () => {
    if (!token || busy) return
    if (!(await confirm({ description: t('timeline.workbench.stopConfirm'), destructive: true }))) return
    setBusy('stop')
    try {
      await cancelWorkbenchJob(token, jobId)
      setStopped(true)
      toast.success(t('timeline.workbench.stopped'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('timeline.workbench.stopError')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className={cn(
        'mt-1 flex max-w-[85%] flex-wrap items-center gap-2 rounded-md border border-border/60 bg-bg-surface px-2.5 py-1.5 text-xs',
        className,
      )}
      data-testid="workbench-job-card"
    >
      <span className="text-text-muted">
        {provider
          ? t('timeline.workbench.labelWithProvider', { provider })
          : t('timeline.workbench.label')}
      </span>
      {showActions ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            disabled={!!busy}
            onClick={() => void onFollowUp()}
            data-testid="workbench-follow-up"
          >
            {busy === 'follow' ? <Loader2 size={12} className="animate-spin" /> : <MessageSquarePlus size={12} />}
            {t('timeline.workbench.followUp')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs text-danger"
            disabled={!!busy}
            onClick={() => void onStop()}
            data-testid="workbench-stop"
          >
            {busy === 'stop' ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
            {t('timeline.workbench.stop')}
          </Button>
        </>
      ) : null}
    </div>
  )
}
