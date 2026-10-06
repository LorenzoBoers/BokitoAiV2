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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'
import { useAuth } from '../../context/AuthContext'
import { bokitoCreateAgent } from '../../lib/bokito-api'
import {
  defaultChatSlug,
  getTenantModels,
  selectableChatModels,
  type SelectableChatModel,
} from '../../lib/models-api'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void
  /** Prefill when duplicating an existing agent. */
  prefill?: { name?: string; model?: string; purpose?: string } | null
}

const WORKSPACE_DEFAULT = '__default__'

export function NewAgentDialog({ open, onOpenChange, onCreated, prefill = null }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [name, setName] = useState('')
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
        setModels(selectableChatModels(data))
        setModel((prev) => prev || defaultChatSlug(data))
      })
      .catch(() => setModelsError(true))
  }

  useEffect(() => {
    if (!open || !token) return
    setName(prefill?.name ?? '')
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

          <div className="space-y-1.5">
            <Label htmlFor="agent-model">{t('workforce.agents.create.model')}</Label>
            <Select
              value={model || WORKSPACE_DEFAULT}
              onValueChange={(value) => setModel(value === WORKSPACE_DEFAULT ? '' : value)}
            >
              <SelectTrigger id="agent-model" className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WORKSPACE_DEFAULT}>{t('workforce.agents.create.workspaceDefault')}</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.slug} value={m.slug}>
                    {m.display_name}
                  </SelectItem>
                ))}
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
            <Label htmlFor="agent-prompt">Purpose</Label>
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
