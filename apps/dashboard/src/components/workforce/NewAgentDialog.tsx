import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, Loader2, Sparkles } from 'lucide-react'
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
import { ModelOptionLabel } from '../ui/ModelIcon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'
import { useAuth } from '../../context/AuthContext'
import { bokitoCreateAgent } from '../../lib/bokito-api'
import {
  AUTOMATIC_MODE,
  INHERIT_MODE,
  agentChatModeOptions,
  getTenantModels,
  normalizeAgentChatMode,
  type SelectableChatModel,
} from '../../lib/models-api'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void
  /** Prefill when duplicating an existing agent. */
  prefill?: { name?: string; model?: string; purpose?: string; description?: string } | null
}

const MAX_DESCRIPTION = 280

export function NewAgentDialog({ open, onOpenChange, onCreated, prefill = null }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('')
  const [purpose, setPurpose] = useState('')
  const [models, setModels] = useState<SelectableChatModel[]>([])
  const [modelsError, setModelsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadModels = () => {
    if (!token) return
    setModelsError(false)
    getTenantModels(token)
      .then((data) => {
        setModels(agentChatModeOptions(data))
        setModel((prev) => prev || INHERIT_MODE)
      })
      .catch(() => setModelsError(true))
  }

  useEffect(() => {
    if (!open || !token) return
    setName(prefill?.name ?? '')
    setDescription(prefill?.description ?? '')
    setModel(normalizeAgentChatMode(prefill?.model) || INHERIT_MODE)
    setPurpose(prefill?.purpose ?? '')
    setError(null)
    setModelsError(false)
    loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, prefill])

  const modeLabel = (slug: string) => {
    if (slug === INHERIT_MODE) return t('workforce.agents.modelMode.inherit')
    if (slug === AUTOMATIC_MODE) return t('workforce.agents.modelMode.automatic')
    return ''
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
        description: description.trim() || undefined,
        model: normalizeAgentChatMode(model) || INHERIT_MODE,
        purpose: purpose.trim() || undefined,
      })
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

          <div className="space-y-1.5">
            <Label htmlFor="agent-description">{t('workforce.agents.create.description')}</Label>
            <Textarea
              id="agent-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
              placeholder={t('workforce.agents.create.descriptionPlaceholder')}
              rows={2}
              maxLength={MAX_DESCRIPTION}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-model">{t('workforce.agents.create.model')}</Label>
            <Select
              value={normalizeAgentChatMode(model) || INHERIT_MODE}
              onValueChange={(value) => setModel(value)}
            >
              <SelectTrigger id="agent-model" className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => {
                  const name = modeLabel(m.slug) || m.display_name
                  if (m.slug === INHERIT_MODE || m.slug === AUTOMATIC_MODE) {
                    return (
                      <SelectItem key={m.slug} value={m.slug}>
                        <span className="inline-flex items-center gap-2">
                          {m.slug === AUTOMATIC_MODE ? (
                            <Sparkles size={16} className="text-ai-ink" aria-hidden />
                          ) : (
                            <Cpu size={16} className="text-text-muted" aria-hidden />
                          )}
                          {name}
                        </span>
                      </SelectItem>
                    )
                  }
                  return (
                    <SelectItem key={m.slug} value={m.slug}>
                      <ModelOptionLabel
                        slug={m.slug}
                        modelId={m.model_id}
                        provider={m.provider}
                        providerType={m.provider_type}
                        name={name}
                      />
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {modelsError ? (
              <button
                type="button"
                onClick={loadModels}
                className="text-xs font-medium text-accent hover:underline"
              >
                {t('workforce.agents.create.modelsRetry')}
              </button>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-prompt">{t('workforce.agents.create.prompt')}</Label>
            <Textarea
              id="agent-prompt"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder={t('workforce.agents.create.promptPlaceholder')}
              rows={5}
            />
          </div>

          {error ? <p className="text-xs text-status-error">{error}</p> : null}
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
