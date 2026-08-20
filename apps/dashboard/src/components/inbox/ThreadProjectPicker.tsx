import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useAuth } from '../../context/AuthContext'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { patchSignalThread } from '../../lib/signals-api'

type Props = {
  threadId: string | number
  projectId: string | null
  onUpdated?: () => void
}

export function ThreadProjectPicker({ threadId, projectId, onUpdated }: Props) {
  const { token } = useAuth()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const rows = await listProjects()
        if (!cancelled) setProjects(rows)
      } catch {
        if (!cancelled) setProjects([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const linked = projects.find((p) => p.id === projectId) ?? null

  const update = async (nextId: string) => {
    if (!token) return
    setSaving(true)
    try {
      await patchSignalThread(token, String(threadId), {
        projectId: nextId === '__none__' ? null : nextId,
      })
      toast.success('Project updated')
      onUpdated?.()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not update project.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1.5 px-4 py-3 border-b border-border/60">
      <Label className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Project</Label>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading projects...
        </div>
      ) : (
        <Select
          value={projectId ?? '__none__'}
          disabled={saving}
          onValueChange={(value) => void update(value)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Link to project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No project</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {linked?.po_agent ? (
        <p className="text-[11px] text-text-muted">
          Orchestrator: {linked.po_agent.name}
        </p>
      ) : linked ? (
        <p className="text-[11px] text-text-muted">No orchestrator linked on this project.</p>
      ) : null}
    </div>
  )
}
