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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void
  /** Prefill when duplicating an existing agent. */
  prefill?: { name?: string; audience?: string; model?: string; purpose?: string } | null
}

const AUDIENCES = ['customers', 'partners', 'internal'] as const

const SELECT_CLASS =
  'w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] text-text-primary disabled:opacity-50'

type ModelOption = TenantModelRow | CatalogModel

export function NewAgentDialog({ open, onOpenChange, onCreated, prefill = null }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [name, setName] = useState('')
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>('internal')
  const [model, setModel] = useState('')
  const [purpose, setPurpose] = useState('')
  const [models, setModels] = useState<ModelOption[]>([])
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
    setName(prefill?.name ?? '')
    setAudience(
      prefill?.audience && AUDIENCES.includes(prefill.audience as (typeof AUDIENCES)[number])
        ? (prefill.audience as (typeof AUDIENCES)[number])
        : 'internal',
    )
    setModel(prefill?.model ?? '')
    setPurpose(prefill?.purpose ?? '')
    setError(null)
    setModelsError(false)
    loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, prefill])

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
        audience,
        model: model || undefined,
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-audience">
                {t('workforce.agents.create.audience', { defaultValue: 'Audience' })}
              </Label>
              <select
                id="agent-audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value as (typeof AUDIENCES)[number])}
                className={SELECT_CLASS}
              >
                {AUDIENCES.map((value) => (
                  <option key={value} value={value}>
                    {t(`workforce.agents.audiences.${value}`, {
                      defaultValue: value.charAt(0).toUpperCase() + value.slice(1),
                    })}
                  </option>
                ))}
              </select>
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

          <div className="space-y-1.5">
            <Label htmlFor="agent-prompt">Purpose</Label>
            <Textarea
              id="agent-prompt"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
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
