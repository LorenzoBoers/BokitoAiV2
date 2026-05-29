import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { Input } from '../components/ui/input'
import { PageContent } from '../components/layout/PageContent'
import { createProject } from '../lib/projects-api'
import { projectOrchestratorPath } from '../components/layout/portal-nav'

export default function CreateProject() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [scope, setScope] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const scopeOk = scope.replace(/\s/g, '').length >= 30

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!scopeOk || !name.trim() || !slug.trim()) return
    setLoading(true)
    setError(null)
    try {
      const project = await createProject({
        name: name.trim(),
        slug: slug.trim().toLowerCase().replace(/\s+/g, '-'),
        autonomous_scope: scope.trim(),
      })
      navigate(projectOrchestratorPath(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('project.create.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageContent width="sm" className="space-y-6 py-1">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
          1
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-sm text-text-muted">
          2
        </span>
      </div>
      <p className="text-sm text-text-muted">{t('project.create.stepLabel')}</p>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="text-sm font-medium text-text-primary">
            {t('project.create.scopeLabel')}
          </label>
          <p className="text-xs text-text-muted">{t('project.create.scopeHint')}</p>
          <Textarea
            className="mt-2 min-h-[120px]"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder={t('project.create.scopePlaceholder')}
            maxLength={500}
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text-primary">
            {t('project.create.nameLabel')}
          </label>
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="text-sm font-medium text-text-primary">
            {t('project.create.slugLabel')}
          </label>
          <Input className="mt-1" value={slug} onChange={(e) => setSlug(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-status-error">{error}</p> : null}
        <Button type="submit" disabled={loading || !scopeOk}>
          {loading ? t('project.create.submitting') : t('project.create.submit')}
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </form>
    </PageContent>
  )
}
