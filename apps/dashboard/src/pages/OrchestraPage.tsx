import { useEffect, useState } from 'react'
import { PageContent } from '../components/layout/PageContent'
import { LoadingBlock } from '../components/ui/loading-block'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { useAuth } from '../context/AuthContext'

type TaskItem = { id: string; name: string; schedule_kind: string; enabled: boolean }

export default function OrchestraPage() {
  const { token } = useAuth()
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    fetch('/api/orchestra/tasks', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [token])

  return (
    <PageContent width="xl" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-heading">Orchestra</h1>
        <p className="text-sm text-text-muted mt-1">Tasks, agent profiles, and workstream runs</p>
      </header>
      {loading ? (
        <LoadingBlock label="Loading orchestra..." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Scheduled tasks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-sm text-text-muted">No tasks configured yet.</p>
            ) : (
              tasks.map((t) => (
                <div key={t.id} className="flex justify-between text-sm border-b border-border py-2">
                  <span>{t.name}</span>
                  <span className="text-text-muted">{t.schedule_kind}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </PageContent>
  )
}
