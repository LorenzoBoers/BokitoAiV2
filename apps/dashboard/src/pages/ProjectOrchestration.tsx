import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { ProjectShell } from '../components/project/ProjectShell'
import { ProjectOrchestrationForm } from '../components/project/ProjectOrchestrationForm'
import { ProjectRequiredPoGate } from '../components/project/ProjectRequiredPoGate'
import { useProjectContext } from '../context/ProjectContext'
import { useProjectHubNav } from '../context/ProjectHubNavContext'
import {
  getProjectOrchestration,
  patchProjectOrchestration,
  type ProjectOrchestrationConfig,
} from '../lib/project-orchestration-api'

export default function ProjectOrchestration() {
  const { t } = useTranslation(['nav', 'common'])
  const { projectId, project, loading: projectLoading } = useProjectContext()
  const { poAgent, workstreamsLoading } = useProjectHubNav()
  const [config, setConfig] = useState<ProjectOrchestrationConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setConfig(await getProjectOrchestration(projectId))
    } catch (err) {
      setConfig(null)
      setError(err instanceof Error ? err.message : t('project.orchestration.loadError'))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (patch: Parameters<typeof patchProjectOrchestration>[1]) => {
    setSaving(true)
    setError(null)
    try {
      const next = await patchProjectOrchestration(projectId, patch)
      setConfig(next)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('project.orchestration.saveError'))
      await load()
    } finally {
      setSaving(false)
    }
  }

  const hasOrchestrator = Boolean(poAgent || project?.po_agent_id)

  if (!workstreamsLoading && !projectLoading && !hasOrchestrator) {
    return <ProjectRequiredPoGate projectId={projectId} />
  }

  if (!hasOrchestrator) {
    return (
      <ProjectShell hideContextBar hideTabNav hideWorkerStatus>
        <LoadingBlock label={t('project.po.loading', { defaultValue: 'Loading orchestrator settings…' })} />
      </ProjectShell>
    )
  }

  return (
    <ProjectShell>
      <Card>
        <CardHeader>
          <p className="text-sm text-text-muted">{t('project.orchestration.description')}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <LoadingBlock label={t('project.orchestration.loading')} />
          ) : !config ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{error ?? t('project.orchestration.loadError')}</p>
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                {t('common:actions.retry')}
              </Button>
            </div>
          ) : (
            <>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {savedAt ? (
                <p className="text-xs text-text-muted">{t('project.orchestration.saved')}</p>
              ) : null}
              <ProjectOrchestrationForm config={config} saving={saving} onSave={save} />
            </>
          )}
        </CardContent>
      </Card>
    </ProjectShell>
  )
}
