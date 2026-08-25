import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pencil } from 'lucide-react'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { useAuth } from '../../context/AuthContext'
import { bokitoUpdateAgent } from '../../lib/bokito-api'

type Props = {
  agentId: string
  name: string
  systemPrompt: string
  canEdit: boolean
  onChanged?: () => void
}

/** Identity & instructions card on the agent detail page. Admins can rename the
 * agent and edit its system prompt. */
export function AgentInstructionsCard({ agentId, name, systemPrompt, canEdit, onChanged }: Props) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation()
  const { token } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [draftPrompt, setDraftPrompt] = useState(systemPrompt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) {
      setDraftName(name)
      setDraftPrompt(systemPrompt)
    }
  }, [name, systemPrompt, editing])

  const save = async () => {
    if (!token || busy) return
    if (!draftName.trim()) {
      setError(t('workforce.agents.nameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await bokitoUpdateAgent(token, agentId, {
        name: draftName.trim(),
        system_prompt: draftPrompt,
      })
      setEditing(false)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workforce.agents.instructionsSaveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-text-heading">{t('workforce.agents.instructionsTitle')}</h3>
          <p className="mt-1 text-sm text-text-muted">
            {t('workforce.agents.instructionsBody')}
          </p>
        </div>
        {canEdit && !editing ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil size={14} className="mr-1.5" aria-hidden />
            {t('workforce.agents.editTools')}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-name">{t('workforce.agents.instructionsName')}</Label>
            <Input
              id="edit-agent-name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-prompt">{t('workforce.agents.instructionsPrompt')}</Label>
            <Textarea
              id="edit-agent-prompt"
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={8}
              placeholder={t('workforce.agents.instructionsPlaceholder')}
            />
          </div>
          {error ? <p className="text-[12px] text-status-error">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {tc('actions.save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              {tc('actions.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {systemPrompt.trim() ? (
            <pre className="whitespace-pre-wrap rounded-lg border border-border/60 bg-bg-input/40 px-3 py-2 font-sans text-[13px] leading-relaxed text-text-secondary">
              {systemPrompt}
            </pre>
          ) : (
            <p className="text-sm text-text-muted">
              {t('workforce.agents.instructionsEmpty')}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
