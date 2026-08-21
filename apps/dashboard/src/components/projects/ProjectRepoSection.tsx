import { useState } from 'react'
import { GitBranch, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  connectProjectRepo,
  disconnectProjectRepo,
  reindexProjectRepo,
  type ProjectRow,
} from '../../lib/projects-api'
import { humanizeLabel } from '../../lib/labels'

/**
 * GitHub repository connect / status / reindex / disconnect controls for one
 * project. Shared by the project detail page and any settings surface.
 */
export function ProjectRepoSection({
  project,
  onChanged,
}: {
  project: ProjectRow
  onChanged: () => Promise<void>
}) {
  const [repoName, setRepoName] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>, successMessage: string, failMessage: string) => {
    setBusy(true)
    try {
      await action()
      toast.success(successMessage)
      await onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, failMessage))
    } finally {
      setBusy(false)
    }
  }

  if (!project.github_repo_full_name) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-text-muted">Repository</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            className="flex-1 min-w-[180px]"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="owner/repo"
          />
          <Input
            className="w-28"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !repoName.trim().includes('/')}
            onClick={() =>
              void run(
                () =>
                  connectProjectRepo(project.id, {
                    github_repo_full_name: repoName.trim(),
                    github_default_branch: branch.trim() || 'main',
                  }),
                'Repository connected',
                'Could not connect repository.',
              )
            }
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch size={14} className="mr-1" />}
            Connect
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          Link a GitHub repository so agents can read this project's codebase.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-text-muted">Repository</Label>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded border border-border/60 bg-bg-base px-2 py-1 text-xs">
          {project.github_repo_full_name}
        </code>
        <Badge variant="outline">{project.github_default_branch || 'main'}</Badge>
        {project.repo_index_status ? (
          <Badge variant={project.repo_index_status === 'error' ? 'destructive' : 'secondary'}>
            {humanizeLabel(project.repo_index_status)}
          </Badge>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(() => reindexProjectRepo(project.id), 'Reindex queued', 'Could not queue reindex.')
          }
        >
          <RefreshCw size={13} className="mr-1" />
          Reindex
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(() => disconnectProjectRepo(project.id), 'Repository disconnected', 'Could not disconnect repository.')
          }
        >
          <Unplug size={13} className="mr-1" />
          Disconnect
        </Button>
      </div>
      {project.repo_index_error ? (
        <p className="text-xs text-status-error">{project.repo_index_error}</p>
      ) : null}
    </div>
  )
}

export default ProjectRepoSection
