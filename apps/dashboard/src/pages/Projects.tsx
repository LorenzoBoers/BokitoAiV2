import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { listProjects, type ProjectRow } from '../lib/projects-api'

export default function Projects() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Projects</h1>
        <Button asChild>
          <Link to="/projects/new">New project</Link>
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-text-muted">No projects yet. Create one to get started.</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                className="block rounded-lg border border-border-subtle bg-surface-raised px-4 py-3 hover:bg-surface-muted"
                to={`/project/${p.id}/pkb`}
              >
                <span className="font-medium text-text-primary">{p.name}</span>
                {p.description ? (
                  <p className="mt-1 text-sm text-text-muted">{p.description}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
