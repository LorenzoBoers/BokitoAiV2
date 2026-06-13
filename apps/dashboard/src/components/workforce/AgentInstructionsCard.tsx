import { useEffect, useState } from 'react'
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
      setError('Name cannot be empty.')
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
      setError(err instanceof Error ? err.message : 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-text-heading">Instructions</h3>
          <p className="mt-1 text-sm text-text-muted">
            The system prompt that shapes this agent's behavior and responsibilities.
          </p>
        </div>
        {canEdit && !editing ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil size={14} className="mr-1.5" aria-hidden />
            Edit
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-name">Name</Label>
            <Input
              id="edit-agent-name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-prompt">System prompt</Label>
            <Textarea
              id="edit-agent-prompt"
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={8}
              placeholder="Describe how this agent should behave."
            />
          </div>
          {error ? <p className="text-[12px] text-status-error">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
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
              No custom instructions. This agent uses the default behavior.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
