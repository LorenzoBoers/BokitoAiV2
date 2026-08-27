import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { useAuth } from '../../context/AuthContext'
import { bokitoCreateAgent } from '../../lib/bokito-api'
import {
  defaultChatSlug,
  getTenantModels,
  selectableChatModels,
  type CatalogModel,
  type TenantModelRow,
} from '../../lib/models-api'
import { addProjectAgent, listProjects, type ProjectRow } from '../../lib/projects-api'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void
  /** Prefill when duplicating an existing agent. */
  prefill?: { name?: string; role?: string; model?: string; systemPrompt?: string } | null
}

const ROLE_OPTIONS = ['communication', 'assistant', 'builder', 'orchestra'] as const

const TEMPLATES = [
  { id: 'support', role: 'communication', nameKey: 'workforce.agents.create.templates.supportName' },
  { id: 'assistant', role: 'assistant', nameKey: 'workforce.agents.create.templates.assistantName' },
  { id: 'lead', role: 'orchestra', nameKey: 'workforce.agents.create.templates.leadName' },
] as const

const SELECT_CLASS =
  'w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] text-text-primary disabled:opacity-50'

type ModelOption = TenantModelRow | CatalogModel

export function NewAgentDialog({ open, onOpenChange, onCreated, prefill = null }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [name, setName] = useState('')
  const [role, setRole] = useState('communication')
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [projectId, setProjectId] = useState('')
  const [models, setModels] = useState<ModelOption[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [modelsError, setModelsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadModels = () => {
    if (!token) return
    setModelsError(false)
    getTenantModels(token)
      .then((data) => {
        setModels(selectableChatModels(data))
        setModel((prev) => prev || defaultChatSlug(data))
      })
      .catch(() => setModelsError(true))
  }

  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    setName(prefill?.name ?? '')
    setRole(prefill?.role && ROLE_OPTIONS.includes(prefill.role as (typeof ROLE_OPTIONS)[number]) ? prefill.role : 'communication')
    setModel(prefill?.model ?? '')
    setSystemPrompt(prefill?.systemPrompt ?? '')
    setProjectId('')
    setError(null)
    setModelsError(false)
    loadModels()
    listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows)
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, prefill])

  const applyTemplate = (id: (typeof TEMPLATES)[number]['id']) => {
    const template = TEMPLATES.find((row) => row.id === id)
    if (!template) return
    setRole(template.role)
    setName(t(template.nameKey))
    setSystemPrompt(t(`workforce.agents.create.templates.${id}Prompt`))
  }

  const submit = async () => {
    if (!token || busy) return
    if (!name.trim()) {
      setError(t('workforce.agents.create.nameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await bokitoCreateAgent(token, {
        name: name.trim(),
        role,
        model: model || undefined,
        system_prompt: systemPrompt.trim() || undefined,
      })
      if (projectId) {
        try {
          await addProjectAgent(projectId, res.agent.id)
        } catch {
          // Agent exists even if the project link fails.
        }
      }
      onOpenChange(false)
      onCreated(res.agent.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workforce.agents.create.createError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('workforce.agents.create.title')}</DialogTitle>
          <DialogDescription>{t('workforce.agents.create.body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template.id)}
                className="rounded-full border border-border/60 px-2.5 py-0.5 text-[11px] text-text-secondary hover:border-accent/40 hover:text-text-primary"
              >
                {t(`workforce.agents.create.templates.${template.id}`)}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-name">{t('workforce.agents.create.name')}</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('workforce.agents.create.namePlaceholder')}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-role">{t('workforce.agents.create.role')}</Label>
              <select
                id="agent-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={SELECT_CLASS}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`workforce.agents.create.roles.${r}`)}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-text-muted">{t(`workforce.agents.create.roleHints.${role}`)}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-model">{t('workforce.agents.create.model')}</Label>
              <select
                id="agent-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{t('workforce.agents.create.workspaceDefault')}</option>
                {models.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.display_name}
                  </option>
                ))}
              </select>
              {modelsError ? (
                <button
                  type="button"
                  onClick={loadModels}
                  className="text-[11px] font-medium text-accent hover:underline"
                >
                  {t('workforce.agents.create.modelsRetry')}
                </button>
              ) : null}
            </div>
          </div>

          {projects.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="agent-project">{t('workforce.agents.create.project')}</Label>
              <select
                id="agent-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{t('workforce.agents.create.projectNone')}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="agent-prompt">{t('workforce.agents.create.prompt')}</Label>
            <Textarea
              id="agent-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t('workforce.agents.create.promptPlaceholder')}
              rows={5}
            />
          </div>

          {error ? <p className="text-[12px] text-status-error">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('workforce.agents.create.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {t('workforce.agents.create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
