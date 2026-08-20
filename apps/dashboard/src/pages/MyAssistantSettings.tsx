import { useCallback, useEffect, useState } from 'react'
import { Bot, Check, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import { AgentModelCard } from '../components/workforce/AgentModelCard'
import {
  bokitoGetMyAssistant,
  bokitoListChatTargets,
  bokitoPatchMyAssistant,
  type ChatTarget,
  type MyAssistant,
} from '../lib/bokito-api'

/**
 * Personal assistant settings: every user can rename their assistant, tune
 * its instructions, and pick their default chat target.
 */
export default function MyAssistantSettings() {
  const { token } = useAuth()
  const [assistant, setAssistant] = useState<MyAssistant | null>(null)
  const [targets, setTargets] = useState<ChatTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [defaultTarget, setDefaultTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [me, targetData] = await Promise.all([
        bokitoGetMyAssistant(token),
        bokitoListChatTargets(token),
      ])
      setAssistant(me)
      setTargets(targetData.items)
      setName(me.agent.name)
      setInstructions(me.agent.instructions)
      setDefaultTarget(me.default_chat_agent_id)
    } catch {
      setError('Could not load assistant settings.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(async () => {
    if (!token || saving) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const updated = await bokitoPatchMyAssistant(token, {
        name: name.trim() || undefined,
        instructions,
        default_chat_agent_id: defaultTarget || undefined,
      })
      setAssistant(updated)
      setName(updated.agent.name)
      setInstructions(updated.agent.instructions)
      setDefaultTarget(updated.default_chat_agent_id)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }, [token, saving, name, instructions, defaultTarget])

  if (loading) {
    return (
      <PageContent width="lg" className="py-10">
        <div className="flex justify-center text-text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      </PageContent>
    )
  }

  return (
    <PageContent width="lg" className="space-y-6 py-1">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-bg-surface text-accent shadow-card">
          <Bot size={18} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-text-heading">My assistant</h2>
          <p className="text-[12.5px] text-text-muted">
            Your personal assistant is private to you. Rename it, shape its tone, and choose who
            you talk to by default when starting a new chat.
          </p>
        </div>
      </div>

      {error ? <p className="text-[12px] text-status-error">{error}</p> : null}

      <div className="space-y-4 rounded-xl border border-border/60 bg-bg-elevated p-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-secondary" htmlFor="assistant-name">
            Assistant name
          </label>
          <input
            id="assistant-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full max-w-[360px] rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-secondary" htmlFor="assistant-instructions">
            Instructions & tone
          </label>
          <textarea
            id="assistant-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] leading-relaxed text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
            placeholder="How should your assistant behave? What should it know about you and your work?"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-secondary" htmlFor="assistant-default-target">
            Default chat target
          </label>
          <p className="mb-1.5 text-[11.5px] text-text-muted">
            Who a new chat talks to unless you pick someone else.
          </p>
          <select
            id="assistant-default-target"
            value={defaultTarget}
            onChange={(e) => setDefaultTarget(e.target.value)}
            className="w-full max-w-[360px] rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.kind === 'company' ? ' (company agent)' : ' (my assistant)'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            Save changes
          </button>
          {saved ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-status-success">
              <Check size={13} /> Saved
            </span>
          ) : null}
        </div>
      </div>

      {assistant ? (
        <AgentModelCard
          agentId={assistant.agent.id}
          currentModel={assistant.agent.model}
          canEdit
          onChanged={reload}
        />
      ) : null}
    </PageContent>
  )
}
