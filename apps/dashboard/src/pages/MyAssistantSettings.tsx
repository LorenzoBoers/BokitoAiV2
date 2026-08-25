import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bot, Check, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { inboxPath } from '../lib/messages-paths'
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
  const { t } = useTranslation('nav')
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
      setError(t('assistantSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }, [token, t])

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
      setError(err instanceof Error ? err.message : t('assistantSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }, [token, saving, name, instructions, defaultTarget, t])

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
          <h2 className="text-[15px] font-semibold text-text-heading">{t('assistantSettings.title')}</h2>
          <p className="text-[12.5px] text-text-muted">
            {t('assistantSettings.body')}
          </p>
        </div>
      </div>

      {error ? <p className="text-[12px] text-status-error">{error}</p> : null}

      <div className="space-y-4 rounded-xl border border-border/60 bg-bg-elevated p-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-secondary" htmlFor="assistant-name">
            {t('assistantSettings.name')}
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
            {t('assistantSettings.instructions')}
          </label>
          <textarea
            id="assistant-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] leading-relaxed text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
            placeholder={t('assistantSettings.instructionsPlaceholder')}
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-text-secondary" htmlFor="assistant-default-target">
            {t('assistantSettings.defaultTarget')}
          </label>
          <p className="mb-1.5 text-[11.5px] text-text-muted">
            {t('assistantSettings.defaultTargetHint')}
          </p>
          <select
            id="assistant-default-target"
            value={defaultTarget}
            onChange={(e) => setDefaultTarget(e.target.value)}
            className="w-full max-w-[360px] rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
                {target.kind === 'company'
                  ? ` (${t('assistantSettings.companyAgent')})`
                  : ` (${t('assistantSettings.myAssistant')})`}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {t('assistantSettings.save')}
          </button>
          {saved ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-status-success">
              <Check size={13} /> {t('assistantSettings.saved')}
            </span>
          ) : null}
          <Link
            to={inboxPath('all')}
            className="text-[12px] font-medium text-accent hover:underline"
          >
            {t('assistantSettings.openCommunication')}
          </Link>
          <Link
            to="/settings/models"
            className="text-[12px] font-medium text-accent hover:underline"
          >
            {t('assistantSettings.openModels')}
          </Link>
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
