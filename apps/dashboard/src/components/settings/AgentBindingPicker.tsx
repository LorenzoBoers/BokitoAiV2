import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listAgents } from '../../lib/agents-api'
import {
  createChannelBinding,
  deleteChannelBinding,
  listChannelBindings,
  type ChannelBinding,
} from '../../lib/channel-bindings-api'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { AgentSelect } from '../ui/AgentSelect'
import type { AgentVisualFields } from '../ui/AgentOptionRow'

type AgentOption = AgentVisualFields & { isLead: boolean }

/**
 * Which agent handles this item (a mailbox, a WhatsApp number, the widget…).
 *
 * Renders a compact select backed by ChannelBinding rows: picking an agent
 * creates a binding scoped to `channelAccountId` (or channel-wide when null);
 * picking the default removes it so the lead agent takes over.
 */
export default function AgentBindingPicker({
  channel,
  channelAccountId = null,
  className,
  'aria-label': ariaLabel,
}: {
  channel: string
  /** ChannelAccount UUID for item-scoped bindings; null = channel-wide. */
  channelAccountId?: string | null
  className?: string
  'aria-label'?: string
}) {
  const { t } = useTranslation('nav')
  const isAdmin = useIsAdmin()
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [matching, setMatching] = useState<ChannelBinding[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const isMatch = useCallback(
    (b: ChannelBinding) =>
      b.channel === channel &&
      !b.contact_id &&
      (channelAccountId ? b.channel_account_id === channelAccountId : !b.channel_account_id),
    [channel, channelAccountId],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [agentRows, bindingRows] = await Promise.all([listAgents(), listChannelBindings()])
        if (cancelled) return
        setAgents(
          agentRows.map((a) => ({
            id: a.id,
            name: a.name,
            isLead: Boolean(a.is_lead),
            avatar_kind: a.avatar_kind,
            avatar_icon: a.avatar_icon,
            avatar_color: a.avatar_color,
            avatar_image_url: a.avatar_image_url,
          })),
        )
        setMatching(bindingRows.filter(isMatch))
      } catch {
        if (!cancelled) {
          setAgents([])
          setMatching([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isMatch])

  const current = matching.find((b) => b.enabled) ?? matching[0] ?? null
  const leadName = agents.find((a) => a.isLead)?.name ?? ''
  const defaultLabel = leadName
    ? t('bindingPicker.leadDefaultNamed', { name: leadName })
    : t('bindingPicker.leadDefault')

  const handleChange = async (nextAgentId: string) => {
    setBusy(true)
    try {
      for (const binding of matching) {
        await deleteChannelBinding(binding.id)
      }
      if (nextAgentId && nextAgentId !== '__empty__') {
        const created = await createChannelBinding({
          channel,
          agent_id: nextAgentId,
          channel_account_id: channelAccountId ?? undefined,
          priority: channelAccountId ? 20 : 10,
          enabled: true,
        })
        setMatching([created])
      } else {
        setMatching([])
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('bindingPicker.saveError')))
    } finally {
      setBusy(false)
    }
  }

  const selectable = useMemo(() => {
    const base = agents.filter((a) => !a.isLead)
    if (!current) return base
    if (base.some((a) => a.id === current.agent_id)) return base
    const bound = agents.find((a) => a.id === current.agent_id)
    if (bound) return [...base, bound]
    return [
      ...base,
      {
        id: current.agent_id,
        name: t('bindingPicker.unknownAgent'),
        isLead: false,
      },
    ]
  }, [agents, current, t])

  return (
    <AgentSelect
      agents={selectable}
      value={current?.agent_id ?? ''}
      disabled={!isAdmin || busy || loading}
      onValueChange={(v) => void handleChange(v)}
      emptyOption={{ value: '__empty__', label: defaultLabel }}
      aria-label={ariaLabel ?? t('bindingPicker.ariaLabel')}
      triggerClassName={
        className ??
        'h-8 max-w-[16rem] rounded-md border border-border/60 bg-bg-elevated px-2 text-xs text-text-secondary'
      }
      placeholder={defaultLabel}
    />
  )
}
