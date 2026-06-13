import { useEffect, useState } from 'react'
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
import {
  bokitoCreateAgent,
  bokitoGetTenantModels,
  type CatalogModel,
} from '../../lib/bokito-api'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void
}

const ROLE_OPTIONS = [
  { value: 'assistant', label: 'Assistant' },
  { value: 'communication', label: 'Communication' },
  { value: 'builder', label: 'Builder' },
  { value: 'orchestra', label: 'Orchestra' },
]

const SELECT_CLASS =
  'w-full rounded-lg border border-border/70 bg-bg-input px-3 py-2 text-[13px] text-text-primary disabled:opacity-50'

/** Create a new company worker agent. Model choices come from the workspace
 * model catalog; the new agent opens on its detail page. */
export function NewAgentDialog({ open, onOpenChange, onCreated }: Props) {
  const { token } = useAuth()
  const [name, setName] = useState('')
  const [role, setRole] = useState('assistant')
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [models, setModels] = useState<CatalogModel[]>([])
  const [allowed, setAllowed] = useState<string[]>([])
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
    bokitoGetTenantModels(token)
      .then((data) => {
        if (cancelled) return
        const chat = data.models.filter((m) => m.kind === 'chat')
        setModels(chat)
        setAllowed(data.prefs.allowed_chat ?? [])
        setModel(data.prefs.default_chat || '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, token])

  const isAllowed = (slug: string) => allowed.length === 0 || allowed.includes(slug)

  const submit = async () => {
    if (!token || busy) return
    if (!name.trim()) {
      setError('Name is required.')
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
      setError(err instanceof Error ? err.message : 'Could not create agent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Create a company agent your team can chat with and assign work to.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Support Specialist"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-role">Role</Label>
              <select
                id="agent-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={SELECT_CLASS}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-model">Model</Label>
              <select
                id="agent-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Workspace default</option>
                {models.map((m) => (
                  <option key={m.slug} value={m.slug} disabled={!isAllowed(m.slug)}>
                    {m.display_name}
                    {!isAllowed(m.slug) ? ' (blocked)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-prompt">System prompt (optional)</Label>
            <Textarea
              id="agent-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Describe how this agent should behave and what it is responsible for."
              rows={5}
            />
          </div>

          {error ? <p className="text-[12px] text-status-error">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            Create agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
