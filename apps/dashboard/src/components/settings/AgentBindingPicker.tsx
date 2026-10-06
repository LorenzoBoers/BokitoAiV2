import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { listAgents } from '../../lib/agents-api'
import {
  listChannelAccounts,
  updateChannelDefaultAgent,
} from '../../lib/channel-accounts-api'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { AgentSelect } from '../ui/AgentSelect'
import type { AgentVisualFields } from '../ui/AgentOptionRow'

type AgentOption = AgentVisualFields & {
  isLead: boolean
  slug: string
}

/**
 * Which agent handles this item (a mailbox, a WhatsApp number, the widget…).
 *
 * Writes `ChannelAccount.default_agent_id` (live routing). The empty option is
 * Front desk (customer-facing) when present, otherwise the lead agent.
 */
export default function AgentBindingPicker({
  channel,
  channelAccountId = null,
  defaultAgentId: initialDefaultAgentId,
  onChanged,
  className,
  'aria-label': ariaLabel,
}: {
  channel: string
  /** ChannelAccount UUID for item-scoped defaults; null = first account for channel. */
  channelAccountId?: string | null
  /**
   * Seed from the channel row when known. Omit to hydrate from the accounts
   * list; pass `null` when the channel has no bound agent.
   */
  defaultAgentId?: string | null
  onChanged?: () => void
  className?: string
  'aria-label'?: string
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [resolvedAccountId, setResolvedAccountId] = useState<string | null>(channelAccountId)
  const [agentId, setAgentId] = useState<string | null>(initialDefaultAgentId ?? null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const seeded = initialDefaultAgentId !== undefined

  useEffect(() => {
    setResolvedAccountId(channelAccountId)
  }, [channelAccountId])

  useEffect(() => {
    if (initialDefaultAgentId !== undefined) setAgentId(initialDefaultAgentId)
  }, [initialDefaultAgentId])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const agentRows = await listAgents()
      setAgents(
        agentRows.map((a) => ({
          id: a.id,
          name: a.name,
          isLead: Boolean(a.is_lead),
          slug: typeof a.slug === 'string' ? a.slug : '',
          avatar_kind: a.avatar_kind,
          avatar_icon: a.avatar_icon,
          avatar_color: a.avatar_color,
          avatar_image_url: a.avatar_image_url,
        })),
      )
      // Parent passed the account id: keep the control editable even if the
      // accounts list fails. Only fetch the list to hydrate when unbound/unseeded.
      if (channelAccountId && seeded) {
        setResolvedAccountId(channelAccountId)
        return
      }
      const accountRows = await listChannelAccounts(token)
      if (channelAccountId) {
        const match = accountRows.find((row) => row.id === channelAccountId) ?? null
        setResolvedAccountId(channelAccountId)
        if (match && !seeded) setAgentId(match.defaultAgentId)
      } else {
        const match = accountRows.find((row) => row.channel === channel) ?? null
        setResolvedAccountId(match?.id ?? null)
        if (match && !seeded) setAgentId(match.defaultAgentId)
      }
    } catch {
      setAgents([])
      if (!channelAccountId) setResolvedAccountId(null)
    } finally {
      setLoading(false)
    }
  }, [channel, channelAccountId, seeded, token])

  useEffect(() => {
    void load()
  }, [load])

  const frontDesk = useMemo(
    () => agents.find((a) => a.slug === 'front-desk') ?? null,
    [agents],
  )
  const leadName = agents.find((a) => a.isLead)?.name ?? ''
  const defaultName = frontDesk?.name || leadName
  const defaultLabel = defaultName || t('bindingPicker.leadDefault')
  const defaultBadge = defaultName ? t('bindingPicker.defaultBadge') : undefined

  const currentAgentId = agentId ?? ''
  // Bound-to-Front-desk looks like the empty default so the picker stays clear.
  const selectValue =
    frontDesk && currentAgentId === frontDesk.id ? '' : currentAgentId

  const persist = async (nextAgentId: string) => {
    if (!token || !resolvedAccountId) {
      toast.error(t('bindingPicker.saveError'))
      return
    }
    const previous = agentId
    setBusy(true)
    try {
      const resolved =
        !nextAgentId || nextAgentId === '__empty__'
          ? frontDesk?.id ?? null
          : nextAgentId
      setAgentId(resolved)
      const changed = await updateChannelDefaultAgent(token, resolvedAccountId, resolved)
      if (changed) setAgentId(changed.defaultAgentId)
      onChanged?.()
    } catch (err) {
      setAgentId(previous)
      toast.error(formatApiErrorMessage(err, t('bindingPicker.saveError')))
    } finally {
      setBusy(false)
    }
  }

  const selectable = useMemo(() => {
    const base = agents.filter((a) => !frontDesk || a.id !== frontDesk.id)
    if (!selectValue) return base
    if (base.some((a) => a.id === selectValue)) return base
    const bound = agents.find((a) => a.id === selectValue)
    if (bound) return [...base, bound]
    return [
      ...base,
      {
        id: selectValue,
        name: t('bindingPicker.unknownAgent'),
        isLead: false,
        slug: '',
      },
    ]
  }, [agents, frontDesk, selectValue, t])

  return (
    <AgentSelect
      agents={selectable}
      value={selectValue}
      disabled={!isAdmin || busy || loading || !resolvedAccountId || !token}
      onValueChange={(v) => void persist(v)}
      emptyOption={{ value: '__empty__', label: defaultLabel, badge: defaultBadge }}
      aria-label={ariaLabel ?? t('bindingPicker.ariaLabel')}
      triggerClassName={
        className ??
        'h-8 max-w-[16rem] rounded-md border border-border/60 bg-bg-elevated px-2 text-xs text-text-secondary'
      }
      placeholder={defaultLabel}
    />
  )
}
