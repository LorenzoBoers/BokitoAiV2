import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pencil } from 'lucide-react'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { useAuth } from '../../context/AuthContext'
import { bokitoUpdateAgent } from '../../lib/bokito-api'

type Props = {
  agentId: string
  name: string
  systemPrompt: string
  canEdit: boolean
  onChanged?: () => void
}

/** Instructions card on the agent detail page. Admins edit the full prompt in a modal. */
export function AgentInstructionsCard({ agentId, systemPrompt, canEdit, onChanged }: Props) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation()
  const { token } = useAuth()
  const [open, setOpen] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState(systemPrompt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setDraftPrompt(systemPrompt)
      setError(null)
    }
  }, [systemPrompt, open])

  const save = async () => {
    if (!token || busy) return
    setBusy(true)
    setError(null)
    try {
      await bokitoUpdateAgent(token, agentId, {
        system_prompt: draftPrompt,
      })
      setOpen(false)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workforce.agents.instructionsSaveError'))
    } finally {
      setBusy(false)
    }
  }

  const prompt = systemPrompt.trim()

  return (
    <Card className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-text-heading">{t('workforce.agents.instructionsTitle')}</h3>
          <p className="mt-1 text-sm text-text-muted">
            {t('workforce.agents.instructionsBody')}
          </p>
        </div>
        {canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Pencil size={14} className="mr-1.5" aria-hidden />
            {t('workforce.agents.editInstructions')}
          </Button>
        ) : null}
      </div>

      <div className="mt-3">
        {prompt ? (
          <pre className="truncate-fade-y truncate-fade-y-long max-h-[calc(1.625em*10)] whitespace-pre-wrap rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 font-sans text-sm leading-relaxed text-text-secondary">
            {prompt}
          </pre>
        ) : (
          <p className="text-sm text-text-muted">
            {t('workforce.agents.instructionsEmpty')}
          </p>
        )}
      </div>

      {canEdit ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('workforce.agents.instructionsTitle')}</DialogTitle>
              <DialogDescription>{t('workforce.agents.instructionsBody')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="edit-agent-prompt">{t('workforce.agents.instructionsPrompt')}</Label>
              <Textarea
                id="edit-agent-prompt"
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                rows={16}
                className="min-h-[20rem] font-sans"
                placeholder={t('workforce.agents.instructionsPlaceholder')}
              />
            </div>
            {error ? <p className="text-xs text-status-error">{error}</p> : null}
            <DialogFooter>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                {tc('actions.cancel')}
              </Button>
              <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
                {tc('actions.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  )
}
