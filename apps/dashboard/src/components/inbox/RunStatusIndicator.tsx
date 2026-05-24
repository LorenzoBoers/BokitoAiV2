import { useEffect, useState } from 'react'
import { workforceRoutes } from '../../api/routes'
import { xanoGetWorkforce } from '../../lib/xano'

type RunStatus = {
  state: string
  started_at: string
  task_subject: string
  finished: boolean
}

type Props = {
  workLogId: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.max(1, Math.floor(diff / 60000))
  return `${mins} minute${mins === 1 ? '' : 's'} ago`
}

export function RunStatusIndicator({ workLogId }: Props) {
  const [status, setStatus] = useState<RunStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await xanoGetWorkforce<RunStatus>(workforceRoutes.runs.status(workLogId))
        if (!cancelled) setStatus(data)
      } catch {
        if (!cancelled) setStatus(null)
      }
    }
    void load()
    const t = setInterval(load, 15000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [workLogId])

  if (!status || status.finished) return null

  const subject = status.task_subject || 'your request'
  const line =
    status.state === 'awaiting_human'
      ? 'Your team had to pause — check the open question above.'
      : status.state === 'reviewing'
        ? 'Your team is reviewing the result — finishing soon.'
        : `Your team is working on "${subject}" — started ${relativeTime(status.started_at)}.`

  return (
    <div className="border-t border-border/60 bg-bg-elevated px-4 py-3 text-sm text-text-primary">
      {line}
    </div>
  )
}
