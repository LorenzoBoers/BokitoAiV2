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
}

const ROLE_OPTIONS = ['assistant', 'communication', 'builder', 'orchestra'] as const

const SELECT_CLASS =
  'w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] text-text-primary disabled:opacity-50'

type ModelOption = TenantModelRow | CatalogModel

export function NewAgentDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [name, setName] = useState('')
  const [role, setRole] = useState('assistant')
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [models, setModels] = useState<ModelOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    setName('')
    setRole('assistant')
    setModel('')
    setSystemPrompt('')
    setError(null)
    getTenantModels(token)
      .then((data) => {
        if (cancelled) return
        setModels(selectableChatModels(data))
        setModel(defaultChatSlug(data))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, token])

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
            </div>
          </div>

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
