import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { dialKeyLabel } from '../../lib/chat-stack'
import { fetchDockAgents, saveDockAgents, type DockConfig } from '../../lib/dock-agents'
import { cn } from '../../lib/utils'
import { Avatar } from '../ui/avatar'
import { Pressable } from '../ui/pressable'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'

/** Pin an agent to the dock on a free dial key, or move a pinned agent to another key. */
export function DockPinPicker({
  open,
  onOpenChange,
  agentId: fixedAgentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselected (agent page, "Change key"); the agent list is hidden then. */
  agentId?: string | null
}) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const { agents } = useAgents()
  const [config, setConfig] = useState<DockConfig | null>(null)
  const [agentId, setAgentId] = useState<string>('')
  const [dialKey, setDialKey] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !token) return
    setQuery('')
    setAgentId(fixedAgentId ?? '')
    let cancelled = false
    void fetchDockAgents(token)
      .then((next) => {
        if (cancelled) return
        setConfig(next)
        const used = new Set(next.pins.map((pin) => pin.dialKey))
        const own = next.pins.find((pin) => pin.agentId === fixedAgentId)
        setDialKey(own?.dialKey ?? next.keys.find((key) => !used.has(key)) ?? next.keys[0] ?? '')
      })
      .catch(() => {
        if (!cancelled) setConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, token, fixedAgentId])

  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const holder = useMemo(() => {
    const map = new Map<string, string>()
    for (const pin of config?.pins ?? []) map.set(pin.dialKey, pin.agentId)
    return map
  }, [config])
  const pinnedIds = useMemo(() => new Set((config?.pins ?? []).map((pin) => pin.agentId)), [config])
  const listed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return agents
      .filter((agent) => !q || agent.name.toLowerCase().includes(q))
      .sort((a, b) => Number(pinnedIds.has(a.id)) - Number(pinnedIds.has(b.id)) || a.name.localeCompare(b.name))
  }, [agents, query, pinnedIds])

  const save = async () => {
    if (!token || !config || !agentId || !dialKey) return
    setBusy(true)
    try {
      const rest = config.pins.filter((pin) => pin.agentId !== agentId && pin.dialKey !== dialKey)
      await saveDockAgents(token, [...rest, { agentId, dialKey }])
      toast.success(t('dock.pinned', { name: byId.get(agentId)?.name ?? '', key: dialKeyLabel(dialKey) }))
      onOpenChange(false)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('dock.pinFailed')))
    } finally {
      setBusy(false)
    }
  }

  const replacing = dialKey ? holder.get(dialKey) : undefined
  const replacingName = replacing && replacing !== agentId ? byId.get(replacing)?.name : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {fixedAgentId && pinnedIds.has(fixedAgentId) ? t('dock.changeKeyTitle') : t('dock.pinTitle')}
          </DialogTitle>
          <DialogDescription>{t('dock.pinHint')}</DialogDescription>
        </DialogHeader>
        {!fixedAgentId ? (
          <div className="space-y-2">
            <Input
              autoFocus
              value={query}
              placeholder={t('dock.searchAgents')}
              aria-label={t('dock.searchAgents')}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="max-h-56 overflow-y-auto rounded-md border border-border" role="listbox">
              {listed.map((agent) => (
                <Pressable
                  key={agent.id}
                  role="option"
                  aria-selected={agentId === agent.id}
                  className={cn(
                    'flex items-center gap-2 rounded-none px-3 py-1.5 text-sm',
                    agentId === agent.id ? 'bg-bg-hover text-text-heading' : 'hover:bg-bg-hover/50',
                  )}
                  onClick={() => setAgentId(agent.id)}
                >
                  <Avatar
                    kind="agent"
                    agent={{
                      name: agent.name,
                      avatar_kind: agent.avatar_kind ?? agent.kind,
                      avatar_icon: agent.avatar_icon,
                      avatar_color: agent.avatar_color,
                      avatar_shape: agent.avatar_shape,
                      avatar_image_url: agent.avatar_image_url,
                    }}
                    size={20}
                    decorative
                  />
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  {pinnedIds.has(agent.id) ? (
                    <span className="text-2xs text-text-muted">
                      {dialKeyLabel(config?.pins.find((pin) => pin.agentId === agent.id)?.dialKey ?? null)}
                    </span>
                  ) : null}
                </Pressable>
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('dock.key')}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('dock.key')}>
            {(config?.keys ?? []).map((key) => {
              const taken = holder.get(key)
              return (
                <Pressable
                  key={key}
                  role="radio"
                  aria-checked={dialKey === key}
                  title={taken && taken !== agentId ? byId.get(taken)?.name : undefined}
                  className={cn(
                    'h-7 w-auto min-w-10 border px-2 text-center text-xs font-medium tabular-nums',
                    dialKey === key
                      ? 'border-accent bg-bg-hover text-text-heading'
                      : 'border-border text-text-secondary hover:text-text-heading',
                    taken && taken !== agentId && dialKey !== key && 'opacity-60',
                  )}
                  onClick={() => setDialKey(key)}
                >
                  {dialKeyLabel(key)}
                </Pressable>
              )
            })}
          </div>
          {replacingName ? (
            <p className="text-xs text-text-muted">{t('dock.replaces', { name: replacingName })}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('moveConversation.cancel')}
          </Button>
          <Button type="button" disabled={busy || !agentId || !dialKey} onClick={() => void save()}>
            {t('dock.pinConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
