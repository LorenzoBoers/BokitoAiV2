import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, MessageSquare } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../ui/card'
import {
  getAgentChatAccess,
  updateAgentChatAccess,
  type AgentChatAccess,
  type ChatAccessMode,
} from '../../lib/workforce-api'
import { cn } from '../../lib/utils'

/** Admin card: who in the workspace may open a direct chat with this company agent. */
export function AgentChatAccessCard({ agentId }: { agentId: string }) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const modes = useMemo(
    (): { value: ChatAccessMode; label: string; description: string }[] => [
      { value: 'everyone', label: t('workforce.agents.chatAccessEveryone'), description: t('workforce.agents.chatAccessEveryoneHint') },
      { value: 'selected', label: t('workforce.agents.chatAccessSelected'), description: t('workforce.agents.chatAccessSelectedHint') },
      { value: 'nobody', label: t('workforce.agents.chatAccessNobody'), description: t('workforce.agents.chatAccessNobodyHint') },
    ],
    [t],
  )
  const [access, setAccess] = useState<AgentChatAccess | null>(null)
  const [mode, setMode] = useState<ChatAccessMode>('nobody')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const data = await getAgentChatAccess(token ?? undefined, agentId)
        if (cancelled) return
        setAccess(data)
        setMode(data.mode)
        setSelectedIds(new Set(data.members.filter((m) => m.selected).map((m) => m.id)))
      } catch {
        if (!cancelled) setError(t('workforce.agents.chatAccessLoadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token, agentId, t])

  const save = useCallback(
    async (nextMode: ChatAccessMode, nextIds: Set<string>) => {
      setSaving(true)
      setSaved(false)
      setError(null)
      try {
        const data = await updateAgentChatAccess(
          token ?? undefined,
          agentId,
          nextMode,
          nextMode === 'selected' ? Array.from(nextIds) : [],
        )
        setAccess(data)
        setMode(data.mode)
        setSelectedIds(new Set(data.members.filter((m) => m.selected).map((m) => m.id)))
        setSaved(true)
        window.setTimeout(() => setSaved(false), 2000)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('workforce.agents.chatAccessSaveError'))
      } finally {
        setSaving(false)
      }
    },
    [token, agentId, t],
  )

  const chooseMode = (next: ChatAccessMode) => {
    setMode(next)
    void save(next, selectedIds)
  }

  const toggleMember = (userId: string) => {
    const next = new Set(selectedIds)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    setSelectedIds(next)
    void save('selected', next)
  }

  if (loading) {
    return (
      <Card className="flex items-center gap-2 px-4 py-3 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin" /> {t('workforce.agents.chatAccessLoading')}
      </Card>
    )
  }
  if (!access) return null

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-base font-semibold text-text-heading">
            <MessageSquare size={15} className="text-text-muted" aria-hidden />
            {t('workforce.agents.chatAccessTitle')}
          </h3>
          <p className="text-sm text-text-muted">
            {t('workforce.agents.chatAccessBody')}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          {saved ? (
            <span className="inline-flex items-center gap-1 text-status-success">
              <Check size={12} /> {t('workforce.agents.chatAccessSaved')}
            </span>
          ) : null}
        </span>
      </div>

      {error ? <p className="mt-2 text-[12px] text-status-error">{error}</p> : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {modes.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => chooseMode(m.value)}
            className={cn(
              'rounded-xl border px-3 py-2.5 text-left transition-colors',
              mode === m.value
                ? 'border-accent/50 bg-accent/8'
                : 'border-border/60 bg-bg-elevated/40 hover:border-border hover:bg-bg-hover/50',
            )}
          >
            <p className={cn('text-[13px] font-medium', mode === m.value ? 'text-accent' : 'text-text-heading')}>
              {m.label}
            </p>
            <p className="mt-0.5 text-[11.5px] text-text-muted">{m.description}</p>
          </button>
        ))}
      </div>

      {mode === 'selected' ? (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.agents.chatAccessMembers')}
          </p>
          <div className="mt-1.5 space-y-1">
            {access.members.map((member) => {
              const checked = selectedIds.has(member.id)
              return (
                <label
                  key={member.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/60 bg-bg-elevated/40 px-3 py-2 transition-colors hover:bg-bg-hover/50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMember(member.id)}
                    className="h-3.5 w-3.5 accent-[var(--accent,#6366f1)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-text-primary">{member.name}</span>
                    <span className="block truncate text-[10.5px] text-text-muted">{member.email}</span>
                  </span>
                  <span className="shrink-0 rounded-full border border-border/60 bg-bg-surface px-1.5 py-px text-[10px] capitalize text-text-muted">
                    {member.role}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
