import { useParams } from 'react-router-dom'
import { LiveWorkLog } from '../components/observability/LiveWorkLog'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { Navigate } from 'react-router-dom'

export default function AdminRuns() {
  const { workLogId } = useParams<{ workLogId?: string }>()
  const isAdmin = useIsAdmin()

  if (!isAdmin) {
    return <Navigate to="/messages" replace />
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold text-text-primary">Agent runs (admin)</h1>
      <p className="text-sm text-text-muted">Raw work log stream for Bokito staff and workspace admins.</p>
      {workLogId ? (
        <LiveWorkLog workLogId={workLogId} />
      ) : (
        <p className="text-sm text-text-muted">Open a run from the queue monitor or paste a work_log_id in the URL.</p>
      )}
    </div>
  )
}
