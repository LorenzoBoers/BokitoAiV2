import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { indexStatusLabel } from '../../lib/status-labels'
import { listGithubConnections } from '../../lib/github-api'

/**
 * GitHub repository connect / status / reindex / disconnect controls for one
 * project. Shared by the project detail page and any settings surface.
 */
export function ProjectRepoSection({
  project,
  onChanged,
  canEdit = true,
}: {
  project: ProjectRow
  onChanged: () => Promise<void>
  canEdit?: boolean
}) {
  const { t } = useTranslation('nav')
  const [repoName, setRepoName] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)
  const [githubReady, setGithubReady] = useState<boolean | null>(null)

  useEffect(() => {
    listGithubConnections()
      .then((rows) => setGithubReady(rows.some((row) => row.status === 'active')))
      .catch(() => setGithubReady(false))
  }, [])

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
    if (!canEdit) {
      return <p className="text-sm text-text-muted">{t('projects.page.noRepo')}</p>
    }
    if (githubReady === false) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">{t('project.settings.repo.connectGithubFirst')}</p>
          <Button type="button" size="sm" variant="outline" asChild>
            <Link to={`/modules/connected?return=${encodeURIComponent(`/projects/${project.id}`)}`}>
              {t('project.settings.repo.openIntegrations')}
            </Link>
          </Button>
        </div>
      )
    }
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-text-muted">{t('project.settings.repo.label')}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            className="flex-1 min-w-[180px]"
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder={t('project.settings.repo.placeholder')}
          />
          <Input
            className="w-28"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={t('project.settings.repo.branchPlaceholder')}
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
                t('project.settings.repo.connected'),
                t('project.settings.repo.linkError'),
              )
            }
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch size={14} className="mr-1" />}
            {t('project.settings.repo.connect')}
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          {t('project.settings.repo.hint')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-text-muted">{t('project.settings.repo.label')}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded border border-border/60 bg-bg-base px-2 py-1 text-xs">
          {project.github_repo_full_name}
        </code>
        <Badge variant="outline">{project.github_default_branch || 'main'}</Badge>
        {project.repo_index_status ? (
          <Badge variant={project.repo_index_status === 'error' ? 'destructive' : 'secondary'}>
            {indexStatusLabel(project.repo_index_status, t)}
          </Badge>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(
              () => reindexProjectRepo(project.id),
              t('project.settings.repo.reindexQueued'),
              t('project.settings.repo.reindexError'),
            )
          }
        >
          <RefreshCw size={13} className="mr-1" />
          {t('project.settings.repo.reindex')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(
              () => disconnectProjectRepo(project.id),
              t('project.settings.repo.disconnected'),
              t('project.settings.repo.disconnectError'),
            )
          }
        >
          <Unplug size={13} className="mr-1" />
          {t('project.settings.repo.disconnect')}
        </Button>
      </div>
      {project.repo_index_error ? (
        <p className="text-xs text-status-error">{project.repo_index_error}</p>
      ) : null}
    </div>
  )
}

export default ProjectRepoSection
