import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { listAgents } from '../../lib/agents-api'
import {
  listChannelAccounts,
  updateChannelDefaultAgent,
  type ChannelAccountRow,
} from '../../lib/channel-accounts-api'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { AgentSelect } from '../ui/AgentSelect'
import type { AgentVisualFields } from '../ui/AgentOptionRow'

type AgentOption = AgentVisualFields & {
  isLead: boolean
  audience: string
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
  className,
  'aria-label': ariaLabel,
}: {
  channel: string
  /** ChannelAccount UUID for item-scoped defaults; null = first account for channel. */
  channelAccountId?: string | null
  className?: string
  'aria-label'?: string
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [account, setAccount] = useState<ChannelAccountRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [agentRows, accountRows] = await Promise.all([
        listAgents(),
        listChannelAccounts(token),
      ])
      setAgents(
        agentRows.map((a) => ({
          id: a.id,
          name: a.name,
          isLead: Boolean(a.is_lead),
          audience: typeof a.audience === 'string' ? a.audience : 'internal',
          slug: typeof a.slug === 'string' ? a.slug : '',
          avatar_kind: a.avatar_kind,
          avatar_icon: a.avatar_icon,
          avatar_color: a.avatar_color,
          avatar_image_url: a.avatar_image_url,
        })),
      )
      const match = channelAccountId
        ? accountRows.find((row) => row.id === channelAccountId) ?? null
        : accountRows.find((row) => row.channel === channel) ?? null
      setAccount(match)
    } catch {
      setAgents([])
      setAccount(null)
    } finally {
      setLoading(false)
    }
  }, [channel, channelAccountId, token])

  useEffect(() => {
    void load()
  }, [load])

  const frontDesk = useMemo(
    () =>
      agents.find((a) => a.slug === 'front-desk') ??
      agents.find((a) => a.audience === 'customers') ??
      null,
    [agents],
  )
  const leadName = agents.find((a) => a.isLead)?.name ?? ''
  const defaultName = frontDesk?.name || leadName
  const defaultLabel = defaultName
    ? t('bindingPicker.leadDefaultNamed', { name: defaultName })
    : t('bindingPicker.leadDefault')

  const currentAgentId = account?.defaultAgentId ?? ''
  // Bound-to-Front-desk looks like the empty default so the picker stays clear.
  const selectValue =
    frontDesk && currentAgentId === frontDesk.id ? '' : currentAgentId

  const persist = async (nextAgentId: string) => {
    if (!token || !account) {
      toast.error(t('bindingPicker.saveError'))
      return
    }
    setBusy(true)
    try {
      const resolved =
        !nextAgentId || nextAgentId === '__empty__'
          ? frontDesk?.id ?? null
          : nextAgentId
      const changed = await updateChannelDefaultAgent(token, account.id, resolved)
      if (changed) setAccount(changed)
    } catch (err) {
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
        audience: 'internal',
        slug: '',
      },
    ]
  }, [agents, frontDesk, selectValue, t])

  return (
    <AgentSelect
      agents={selectable}
      value={selectValue}
      disabled={!isAdmin || busy || loading || !account || !token}
      onValueChange={(v) => void persist(v)}
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
