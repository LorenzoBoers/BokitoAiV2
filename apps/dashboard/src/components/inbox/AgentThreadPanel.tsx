import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, FolderKanban, Loader2, X } from 'lucide-react'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { listAgentTasks } from '../../lib/orchestration-api'
import { USE_SIGNAL_INBOX } from '../../lib/signals-api'
import type { InboxThread } from '../../lib/inbox-api'
import { AiAvatar } from '../ui/AiAvatar'
import { OrchestrationPanel } from './OrchestrationPanel'

type Props = {
  thread: InboxThread
  onClose: () => void
}

const STATUS_CLASS: Record<string, string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  inactive: 'text-text-muted',
  error: 'text-status-error',
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
  )
}

export default function AgentThreadPanel({ thread, onClose }: Props) {
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [taskId, setTaskId] = useState<string | null>(null)

  const projectId = thread.projectId ?? null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        if (!projectId) {
          if (!cancelled) setProject(null)
          return
        }
        const projects = await listProjects()
        if (cancelled) return
        setProject(projects.find((p) => p.id === projectId) ?? null)
      } catch {
        if (!cancelled) setProject(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!USE_SIGNAL_INBOX) {
      setTaskId(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const tasks = await listAgentTasks({ signalId: String(thread.id) })
        if (!cancelled) setTaskId(tasks[0]?.id ?? null)
      } catch {
        if (!cancelled) setTaskId(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [thread.id])

  const orchestrator = project?.po_agent ?? null

  return (
    <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-border/50 bg-bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3.5 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Orchestration</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-0.5 text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
          aria-label="Close orchestration panel"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading orchestrator...
          </div>
        ) : (
          <>
            <div className="border-b border-border/40 px-4 pb-3 pt-4">
              <SectionHeading title="Orchestrator agent" />
              {orchestrator ? (
                <Link
                  to={`/os/agents/${orchestrator.id}`}
                  className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-bg-elevated px-3 py-2.5 transition-colors hover:border-accent/50"
                >
                  <AiAvatar name={orchestrator.name} seed={orchestrator.id} size={28} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-heading">
                      {orchestrator.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                      <Bot size={11} />
                      Orchestrator
                    </span>
                    {orchestrator.status ? (
                      <span
                        className={`mt-0.5 block text-xs capitalize ${
                          STATUS_CLASS[orchestrator.status] ?? 'text-text-muted'
                        }`}
                      >
                        {orchestrator.status}
                      </span>
                    ) : null}
                  </span>
                </Link>
              ) : (
                <p className="rounded-lg border border-dashed border-border/50 px-3 py-3 text-xs text-text-muted">
                  No orchestrator linked to this thread's project.
                </p>
              )}
            </div>

            {project ? (
              <div className="border-b border-border/40 px-4 py-3">
                <SectionHeading title="Project" />
                <Link
                  to={`/project/${project.id}/overview`}
                  className="flex items-center gap-2 text-sm text-text-primary hover:text-accent"
                >
                  <FolderKanban size={14} className="text-text-muted" />
                  <span className="truncate">{project.name}</span>
                </Link>
              </div>
            ) : null}

            {taskId ? (
              <div className="px-4 py-3">
                <SectionHeading title="Active task" />
                <OrchestrationPanel taskId={taskId} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
