import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Label } from '../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { LoadingBlock } from '../components/ui/loading-block'
import { ProjectShell } from '../components/project/ProjectShell'
import { useProjectContext } from '../context/ProjectContext'
import {
  getProjectOrchestration,
  patchProjectOrchestration,
  type AutonomyMode,
  type HitlSensitivity,
  type ProjectOrchestrationConfig,
  type WakeCadence,
} from '../lib/project-orchestration-api'

export default function ProjectOrchestration() {
  const { t } = useTranslation('nav')
  const { projectId } = useProjectContext()
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

  return (
    <ProjectShell>
      <Card>
        <CardHeader>
          <CardTitle>{t('project.orchestration.title')}</CardTitle>
          <p className="mt-1 text-sm text-text-muted">{t('project.orchestration.description')}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <LoadingBlock label={t('project.orchestration.loading')} />
          ) : !config ? (
            <p className="text-sm text-destructive">{error ?? t('project.orchestration.loadError')}</p>
          ) : (
            <>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {savedAt ? (
                <p className="text-xs text-text-muted">{t('project.orchestration.saved')}</p>
              ) : null}

              <div className="space-y-2">
                <Label>{t('project.orchestration.wakeFrequency.label')}</Label>
                <p className="text-xs text-text-muted">
                  {t('project.orchestration.wakeFrequency.hint')}
                </p>
                <Select
                  value={config.wake_cadence}
                  disabled={saving}
                  onValueChange={(v) => void save({ wake_cadence: v as WakeCadence })}
                >
                  <SelectTrigger className="w-full sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">
                      {t('project.orchestration.wakeFrequency.options.hourly')}
                    </SelectItem>
                    <SelectItem value="daily">
                      {t('project.orchestration.wakeFrequency.options.daily')}
                    </SelectItem>
                    <SelectItem value="weekly">
                      {t('project.orchestration.wakeFrequency.options.weekly')}
                    </SelectItem>
                    <SelectItem value="manual">
                      {t('project.orchestration.wakeFrequency.options.manual')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('project.orchestration.autonomyMode.label')}</Label>
                <p className="text-xs text-text-muted">{t('project.orchestration.autonomyMode.hint')}</p>
                <Select
                  value={config.autonomy_mode}
                  disabled={saving}
                  onValueChange={(v) => void save({ autonomy_mode: v as AutonomyMode })}
                >
                  <SelectTrigger className="w-full sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">
                      {t('project.orchestration.autonomyMode.options.conservative')}
                    </SelectItem>
                    <SelectItem value="balanced">
                      {t('project.orchestration.autonomyMode.options.balanced')}
                    </SelectItem>
                    <SelectItem value="aggressive">
                      {t('project.orchestration.autonomyMode.options.aggressive')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('project.orchestration.hitl.label')}</Label>
                <p className="text-xs text-text-muted">{t('project.orchestration.hitl.hint')}</p>
                <Select
                  value={config.hitl_sensitivity}
                  disabled={saving}
                  onValueChange={(v) => void save({ hitl_sensitivity: v as HitlSensitivity })}
                >
                  <SelectTrigger className="w-full sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t('project.orchestration.hitl.options.low')}</SelectItem>
                    <SelectItem value="medium">
                      {t('project.orchestration.hitl.options.medium')}
                    </SelectItem>
                    <SelectItem value="high">{t('project.orchestration.hitl.options.high')}</SelectItem>
                    <SelectItem value="all">{t('project.orchestration.hitl.options.all')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {t('project.orchestration.continuous.label')}
                  </p>
                  <p className="text-xs text-text-muted">
                    {t('project.orchestration.continuous.hint')}
                  </p>
                </div>
                <Switch
                  checked={config.continuous_enabled}
                  disabled={saving}
                  onCheckedChange={(checked) => void save({ continuous_enabled: checked })}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </ProjectShell>
  )
}
