import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { ProjectShell } from '../components/project/ProjectShell'
import { ConnectRepoPanel } from '../components/project/ConnectRepoPanel'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { useProjectContext } from '../context/ProjectContext'
import { useOptionalProjectHubNav } from '../context/ProjectHubNavContext'
import { useAuth } from '../context/AuthContext'
import { deleteProject, patchProject } from '../lib/projects-api'
import { projectOrchestratorPath } from '../components/layout/portal-nav'
import { clearLastProjectId, projectHubScopeKey } from '../lib/project-hub-last-opened'

export default function ProjectSettings() {
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const { user } = useAuth()
  const projectHubNav = useOptionalProjectHubNav()
  const { project, projectId, refresh } = useProjectContext()
  const [name, setName] = useState('')
  const [scope, setScope] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const projectName = project?.name?.trim() ?? ''

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

  async function handleDeleteProject() {
    const confirmed = deleteConfirmation.trim()
    if (!project || confirmed !== projectName) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProject(project.id, confirmed)
      const scopeKey = projectHubScopeKey(user?.tenant?.id ?? null, user?.tenant?.slug)
      clearLastProjectId(scopeKey, project.id)
      await projectHubNav?.refresh()
      setShowDeleteDialog(false)
      setDeleteConfirmation('')
      void navigate('/projects')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('project.settings.danger.deleteError'))
    } finally {
      setDeleting(false)
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
            <CardTitle>{t('project.links.po', { defaultValue: 'Orchestrator' })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-text-muted">
              {t('project.settings.orchestrator.description', {
                defaultValue: 'Configure the dedicated orchestrator and orchestration cadence for this project.',
              })}
            </p>
            <Button variant="secondary" size="sm" asChild>
              <Link to={projectOrchestratorPath(projectId)}>
                {t('project.settings.orchestrator.open', { defaultValue: 'Open orchestrator setup' })}
              </Link>
            </Button>
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

        <Card className="border-status-error/40 bg-status-error/5">
          <CardContent className="pt-6">
            <h2 className="mb-3 text-base font-semibold text-status-error">
              {t('project.settings.danger.title')}
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="mb-2 font-medium text-text-heading">
                  {t('project.settings.danger.deleteTitle')}
                </h3>
                <p className="mb-4 text-sm text-text-secondary">
                  {t('project.settings.danger.deleteDescription')}
                </p>
                <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                  {t('project.settings.danger.deleteButton')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {showDeleteDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="mx-4 w-full max-w-md p-6">
            <h3 className="mb-4 text-lg font-semibold text-text-heading">
              {t('project.settings.danger.dialogTitle')}
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              {t('project.settings.danger.dialogPrompt', { name: projectName })}
            </p>
            <Input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder={t('project.settings.danger.namePlaceholder')}
              className="mb-4"
              autoComplete="off"
            />
            {deleteError ? <p className="mb-4 text-sm text-status-error">{deleteError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowDeleteDialog(false)
                  setDeleteConfirmation('')
                  setDeleteError(null)
                }}
                disabled={deleting}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDeleteProject()}
                disabled={deleteConfirmation.trim() !== projectName || deleting}
              >
                {deleting ? t('project.settings.danger.deleting') : t('project.settings.danger.confirmButton')}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </ProjectShell>
  )
}
