import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { ProjectShell } from '../components/project/ProjectShell'
import { ConnectRepoPanel } from '../components/project/ConnectRepoPanel'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { useProjectContext } from '../context/ProjectContext'
import { patchProject } from '../lib/projects-api'

export default function ProjectSettings() {
  const { t } = useTranslation('nav')
  const { project, refresh } = useProjectContext()
  const [name, setName] = useState('')
  const [scope, setScope] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (project) {
      setName(project.name)
      setScope(project.autonomous_scope ?? '')
    }
  }, [project])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!project) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await patchProject(project.id, {
        name: name.trim(),
        autonomous_scope: scope.trim(),
      })
      await refresh()
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('project.settings.about.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProjectShell>
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>{t('project.settings.about.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary">
                  {t('project.settings.about.name')}
                </label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary">
                  {t('project.settings.about.scope')}
                </label>
                <Textarea
                  className="min-h-[120px]"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  required
                />
              </div>
              {error ? <p className="text-sm text-status-error">{error}</p> : null}
              {saved ? (
                <p className="text-sm text-status-success">{t('project.settings.about.saved')}</p>
              ) : null}
              <Button type="submit" disabled={saving}>
                {saving ? t('project.settings.about.saving') : t('project.settings.about.save')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('project.settings.code.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-muted">{t('project.settings.code.description')}</p>
            <div className="mt-4">
              <ConnectRepoPanel
                projectId={project?.id ?? ''}
                project={project}
                onProjectUpdated={() => void refresh()}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </ProjectShell>
  )
}
