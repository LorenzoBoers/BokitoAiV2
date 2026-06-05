import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { LoadingBlock } from '../components/ui/loading-block'
import { listWorkLogs } from '../lib/work-logs-api'
import { projectWorkforceRunUrl } from '../lib/workforce-run-urls'

/** Resolves legacy `/admin/runs/:workLogId` deep links to project-scoped run detail. */
export default function AdminRunLegacyRedirect() {
  const { workLogId } = useParams<{ workLogId: string }>()
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    if (!workLogId) {
      setTarget('/os')
      return
    }
    let cancelled = false
    listWorkLogs({ limit: 100 })
      .then((rows) => {
        if (cancelled) return
        const run = rows.find((r) => r.id === workLogId)
        if (run?.project_id) {
          setTarget(projectWorkforceRunUrl(run.project_id, workLogId))
        } else {
          setTarget('/os')
        }
      })
      .catch(() => {
        if (!cancelled) setTarget('/os')
      })
    return () => {
      cancelled = true
    }
  }, [workLogId])

  if (!target) {
    return (
      <div className="p-6">
        <LoadingBlock />
      </div>
    )
  }

  return <Navigate to={target} replace />
}
