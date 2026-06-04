import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageContent } from '../components/layout/PageContent'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { LoadingBlock } from '../components/ui/loading-block'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useAuth } from '../context/AuthContext'

type TaskItem = {
  id: string
  name: string
  schedule_kind: string
  enabled: boolean
}

const columns = [
  { id: 'idea', title: 'Idea' },
  { id: 'planned', title: 'Planned' },
  { id: 'in_progress', title: 'In progress' },
  { id: 'done', title: 'Done' },
] as const

function columnForTask(task: TaskItem): (typeof columns)[number]['id'] {
  if (!task.enabled && task.schedule_kind !== 'on_demand') return 'done'
  if (task.enabled && task.schedule_kind !== 'on_demand') return 'planned'
  if (task.enabled) return 'in_progress'
  return 'idea'
}

export default function AgendaPage() {
  const { token } = useAuth()
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    fetch('/api/orchestra/tasks', { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Could not load orchestra tasks')
        return r.json()
      })
      .then((rows) => setTasks(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(formatApiErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [token])

  const byColumn = useMemo(() => {
    const map: Record<string, TaskItem[]> = { idea: [], planned: [], in_progress: [], done: [] }
    for (const task of tasks) {
      map[columnForTask(task)].push(task)
    }
    return map
  }, [tasks])

  return (
    <PageContent width="xl" className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">Agenda</h1>
          <p className="text-sm text-text-muted mt-1">Read-only view of Orchestra scheduled tasks</p>
        </div>
        <Link to="/orchestra" className="text-sm text-accent hover:underline">
          Open Orchestra
        </Link>
      </header>

      {error ? <ApiErrorBanner message={error} /> : null}
      {loading ? (
        <LoadingBlock label="Loading agenda..." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {columns.map((col) => (
            <Card key={col.id}>
              <CardHeader>
                <CardTitle className="text-base">{col.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {byColumn[col.id].length === 0 ? (
                  <p className="text-sm text-text-muted">No items</p>
                ) : (
                  byColumn[col.id].map((task) => (
                    <div key={task.id} className="rounded-md border border-border/60 px-2 py-1.5 text-sm">
                      <p className="font-medium text-text-heading">{task.name}</p>
                      <p className="text-xs text-text-muted">{task.schedule_kind}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContent>
  )
}
