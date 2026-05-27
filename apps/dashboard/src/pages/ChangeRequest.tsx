import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { Input } from '../components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { ProjectShell } from '../components/project/ProjectShell'
import { useProjectContext } from '../context/ProjectContext'
import { createChangeRequest } from '../lib/doc-api'
import { cn } from '../lib/utils'

export default function ChangeRequest() {
  const { t } = useTranslation('nav')
  const { projectId } = useProjectContext()
  const navigate = useNavigate()
  const location = useLocation()
  const navState = (location.state as
    | { targetPageId?: string; targetPageTitle?: string }
    | null) ?? null

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'urgent'>('normal')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const priorityMap = { low: 7, normal: 5, urgent: 2 }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId || !body.trim()) return
    setLoading(true)
    setError(null)
    try {
      await createChangeRequest(projectId, {
        body: body.trim(),
        title: title.trim() ? title.trim() : undefined,
        target_page_id: navState?.targetPageId ?? null,
        priority: priorityMap[priority],
      })
      navigate(`/project/${projectId}/communication`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('project.request.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProjectShell>
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('project.request.title')}</CardTitle>
              <p className="mt-1 text-sm text-text-muted">{t('project.request.description')}</p>
              {navState?.targetPageTitle ? (
                <p className="mt-2 inline-block rounded-full border border-border/70 bg-bg-elevated px-2 py-0.5 text-xs text-text-secondary">
                  {t('project.request.targetsPrefix')} {navState.targetPageTitle}
                </p>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('project.request.titlePlaceholder')}
              />
              <Textarea
                className="min-h-[160px]"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('project.request.bodyPlaceholder')}
                required
              />
              <div className="flex gap-2">
                {(['low', 'normal', 'urgent'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                      priority === p
                        ? 'border-accent bg-accent-muted text-accent'
                        : 'border-border/70 bg-bg-elevated text-text-secondary hover:border-border hover:bg-bg-hover',
                    )}
                    onClick={() => setPriority(p)}
                  >
                    {t(`project.request.priority.${p}`)}
                  </button>
                ))}
              </div>
              {error ? <p className="text-sm text-status-error">{error}</p> : null}
              <Button type="submit" disabled={loading || !body.trim()}>
                {loading ? t('project.request.submitting') : t('project.request.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </ProjectShell>
  )
}
