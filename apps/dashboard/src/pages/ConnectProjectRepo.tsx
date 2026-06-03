import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Github, Wrench } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { PageContent } from '../components/layout/PageContent'
import { ConnectRepoPanel } from '../components/project/ConnectRepoPanel'
import { getProject, type ProjectRow } from '../lib/projects-api'
import { parseGithubCallback } from '../lib/github-oauth'

export default function ConnectProjectRepo() {
  const { t } = useTranslation('nav')
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [projectName, setProjectName] = useState('')
  const [oauthReady, setOauthReady] = useState(false)

  const loadProject = useCallback(async () => {
    if (!projectId) return
    try {
      const p = await getProject(projectId)
      setProject(p)
      setProjectName(p.name)
    } catch {
      setProject(null)
      setProjectName('')
    }
  }, [projectId])

  useEffect(() => {
    void loadProject()
  }, [loadProject])

  useEffect(() => {
    const callback = parseGithubCallback(searchParams)
    if (callback.handled) {
      setOauthReady(callback.status === 'connected')
      if (callback.status === 'connected') {
        searchParams.delete('github')
        searchParams.delete('github_error')
        setSearchParams(searchParams, { replace: true })
      }
    }
  }, [searchParams, setSearchParams])

  if (!projectId) {
    return (
      <PageContent width="sm" className="py-1">
        <p className="text-sm text-text-muted">{t('projects.connect.notFound')}</p>
      </PageContent>
    )
  }

  return (
    <PageContent width="md" className="space-y-6 py-1">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-sm text-text-muted">
          1
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
          2
        </span>
      </div>

      <p className="text-sm text-text-muted">
        {t('projects.connect.stepLabel')}
        {projectName ? ` (${projectName})` : ''}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-bg-surface p-5">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5 text-text-primary" />
            <h2 className="font-medium text-text-primary">{t('projects.connect.githubTitle')}</h2>
          </div>
          <p className="mt-2 text-sm text-text-muted">{t('projects.connect.githubDescription')}</p>
          <div className="mt-4">
            <ConnectRepoPanel
              projectId={projectId}
              project={project}
              oauthConnected={oauthReady}
              onConnected={() => navigate(`/project/${projectId}/overview`)}
              onProjectUpdated={() => void loadProject()}
            />
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-border/60 bg-bg-elevated/40 p-5 opacity-80">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-text-muted" />
            <h2 className="font-medium text-text-primary">{t('projects.connect.managedTitle')}</h2>
            <Badge variant="neutral">{t('projects.connect.comingSoon')}</Badge>
          </div>
          <p className="mt-2 text-sm text-text-muted">{t('projects.connect.managedDescription')}</p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/60 pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => navigate(`/projects/new`)}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('projects.connect.back')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigate(`/project/${projectId}/overview`)}
        >
          {t('projects.connect.skip')}
        </Button>
      </div>
    </PageContent>
  )
}
