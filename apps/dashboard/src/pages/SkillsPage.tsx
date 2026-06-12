import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, Zap } from 'lucide-react'
import ContentHeader from '../components/shell/ContentHeader'
import {
  createWorkspaceDoc,
  listWorkspaceDocs,
  type WorkspaceDocRow,
} from '../lib/workspace-api'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

export default function SkillsPage() {
  const navigate = useNavigate()
  const [skills, setSkills] = useState<WorkspaceDocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    listWorkspaceDocs('skill')
      .then(setSkills)
      .catch((err) => setError(formatApiErrorMessage(err, 'Could not load skills.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const createSkill = async () => {
    const name = window.prompt('Skill name (for example: handle-refunds)')
    if (!name?.trim()) return
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!slug) return
    setCreating(true)
    try {
      const doc = await createWorkspaceDoc({
        path: `skills/${slug}.md`,
        kind: 'skill',
        title: name.trim(),
        content: `# ${name.trim()}\n\nDescribe when to use this skill and the steps the agent should follow.\n`,
      })
      navigate(`/workspace/${doc.id}`)
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not create skill.'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <ContentHeader
        title="Skills"
        subtitle="Reusable instructions for agents"
        meta={
          <>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void createSkill()}
              disabled={creating}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              <Plus size={13} />
              New skill
            </button>
          </>
        }
      />

      {error ? <ApiErrorBanner message={error} onRetry={load} /> : null}

      {loading && skills.length === 0 ? (
        <p className="px-1 py-8 text-[12.5px] text-text-muted">Loading skills...</p>
      ) : skills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
          <Zap size={22} className="mx-auto text-text-muted" />
          <h2 className="mt-3 text-[14px] font-semibold text-text-heading">No skills yet</h2>
          <p className="mx-auto mt-1 max-w-[420px] text-[12.5px] text-text-muted">
            Skills are markdown playbooks agents load when relevant: how to handle refunds, how to
            qualify leads, your tone of voice. Create your first one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => navigate(`/workspace/${skill.id}`)}
              className="group flex flex-col rounded-xl border border-border/55 bg-bg-surface/85 px-4 py-3.5 text-left transition-colors hover:border-accent/40"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/55 bg-bg-elevated text-accent">
                  <Zap size={13} />
                </span>
                <span className="min-w-0 truncate text-[13.5px] font-semibold text-text-heading group-hover:text-accent">
                  {skill.title || skill.path}
                </span>
              </span>
              <span className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-text-muted">
                {skill.frontmatter?.description || skill.path}
              </span>
              <span className="mt-3 flex items-center gap-2 font-mono text-[10.5px] text-text-muted">
                <span>{skill.created_by_type}</span>
                <span>-</span>
                <span>updated {formatDate(skill.updated_at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
