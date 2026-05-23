import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { LiveWorkLog } from '../components/observability/LiveWorkLog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'

function formatWhen(value?: string | number | null): string {
  if (value == null || value === '' || value === 0) return '-'
  const d = new Date(typeof value === 'number' ? value : value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

function projectName(projects: ProjectRow[], projectId: string): string {
  return projects.find((p) => p.id === projectId)?.name ?? projectId.slice(0, 8)
}

export default function AdminRuns() {
  const { workLogId } = useParams<{ workLogId?: string }>()
  const isAdmin = useIsAdmin()
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(!workLogId)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (workLogId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const runRows = await listWorkLogs({ limit: 50 })
        if (cancelled) return
        setRuns(runRows)
      } catch (e) {
        if (!cancelled) {
          setRuns([])
          setError(e instanceof Error ? e.message : 'Failed to load runs')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }

      try {
        const projectRows = await listProjects()
        if (!cancelled) setProjects(projectRows)
      } catch {
        if (!cancelled) setProjects([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [workLogId])

  if (!isAdmin) {
    return <Navigate to="/messages" replace />
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Agent runs (admin)</h1>
        <p className="text-sm text-text-muted">
          Run history and live event stream for Bokito staff and workspace admins.
        </p>
      </div>

      {workLogId ? (
        <div className="space-y-3">
          <Link to="/admin/runs" className="text-sm text-accent hover:underline">
            Back to all runs
          </Link>
          <LiveWorkLog workLogId={workLogId} />
        </div>
      ) : (
        <div className="rounded border border-border-subtle bg-surface-raised">
          {loading ? (
            <p className="p-4 text-sm text-text-muted">Loading runs...</p>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : runs.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">No agent runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link
                        to={`/admin/runs/${run.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {run.task_subject || 'Agent run'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-text-muted">{projectName(projects, run.project_id)}</TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell className="text-text-muted">{formatWhen(run.started_at)}</TableCell>
                    <TableCell className="text-text-muted">{run.tokens_used ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  )
}
