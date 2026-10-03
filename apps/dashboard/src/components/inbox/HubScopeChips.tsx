import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { isChannelParked } from '../../lib/channel-surface'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import type { ChannelChip } from '../../lib/messages-paths'
import { bokitoListChatTargets, type ChatTarget } from '../../lib/signals-api'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { cn } from '../../lib/utils'

type ChipOption = { value: ChannelChip; label: string; icon: ReactNode }

type Props = {
  channel: ChannelChip | null
  agentId: string | null
  onChannel: (value: ChannelChip | null) => void
  onAgent: (value: string | null) => void
}

/** Connected channels as chips: each mailbox, plus widget, WhatsApp and Slack. */
function useChannelChips(): ChipOption[] {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { activeConnections } = useMailboxConnections()
  const [accounts, setAccounts] = useState<ChannelAccountRow[]>([])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    listChannelAccounts(token)
      .then((rows) => {
        if (!cancelled) setAccounts(rows.filter((row) => row.isEnabled))
      })
      .catch(() => {
        if (!cancelled) setAccounts([])
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return useMemo(() => {
    const has = (channel: string) => accounts.some((row) => row.channel === channel)
    const options: ChipOption[] = activeConnections.map((conn) => ({
      value: `email:${conn.id}`,
      label: mailboxDisplayLabel(conn.displayName, conn.mailboxEmail),
      icon: <ChannelGlyph channel="email" size={12} />,
    }))
    if (has('widget')) {
      options.push({ value: 'widget', label: t('support.channels.webchat'), icon: <ChannelGlyph channel="widget" size={12} /> })
    }
    if (has('whatsapp')) {
      options.push({ value: 'whatsapp', label: t('support.channels.whatsapp'), icon: <ChannelGlyph channel="whatsapp" size={12} /> })
    }
    if (!isChannelParked('slack') && has('slack')) {
      options.push({ value: 'slack', label: t('support.channels.slack'), icon: <ChannelGlyph channel="slack" size={12} /> })
    }
    return options
  }, [accounts, activeConnections, t])
}

function useCompanyAgents(): ChatTarget[] {
  const { token } = useAuth()
  const [agents, setAgents] = useState<ChatTarget[]>([])
  useEffect(() => {
    if (!token) return
    let cancelled = false
    bokitoListChatTargets(token)
      .then((data) => {
        if (!cancelled) setAgents(data.items.filter((item) => item.kind === 'company'))
      })
      .catch(() => {
        if (!cancelled) setAgents([])
      })
    return () => {
      cancelled = true
    }
  }, [token])
  return agents
}

const chipClass = (active: boolean) =>
  cn(
    'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
    active
      ? 'border-accent/50 bg-accent/10 font-medium text-text-heading'
      : 'border-border/60 text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary',
  )

/**
 * Chips above the thread list: narrow any folder (For you included) to one
 * channel or one agent. Hidden when there is nothing to choose between.
 */
export default function HubScopeChips({ channel, agentId, onChannel, onAgent }: Props) {
  const { t } = useTranslation('communication')
  const channels = useChannelChips()
  const agents = useCompanyAgents()

  if (channels.length < 2 && agents.length === 0 && !channel && !agentId) return null

  const activeAgent = agents.find((agent) => agent.id === agentId) ?? null

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/40 px-3 py-1.5"
      role="toolbar"
      aria-label={t('scopeChips.aria')}
    >
      <button type="button" className={chipClass(!channel)} onClick={() => onChannel(null)}>
        {t('scopeChips.allChannels')}
      </button>
      {channels.map((option) => (
        <button
          key={option.value}
          type="button"
          className={chipClass(channel === option.value)}
          onClick={() => onChannel(channel === option.value ? null : option.value)}
          title={option.label}
        >
          {option.icon}
          <span className="max-w-[10rem] truncate">{option.label}</span>
        </button>
      ))}
      {agents.length > 0 || agentId ? (
        <>
          <span className="mx-1 h-4 w-px shrink-0 bg-border/70" aria-hidden />
          {agentId ? (
            <span className={chipClass(true)}>
              <span className="max-w-[10rem] truncate">
                {activeAgent?.name ?? t('threadList.scopeAgentFallback')}
              </span>
              <button
                type="button"
                onClick={() => onAgent(null)}
                aria-label={t('scopeChips.clearAgent')}
                className="-mr-1 rounded-full p-0.5 text-text-muted hover:text-text-primary"
              >
                <X size={11} aria-hidden />
              </button>
            </span>
          ) : (
            <select
              value=""
              onChange={(event) => onAgent(event.target.value || null)}
              aria-label={t('scopeChips.agent')}
              className="h-6 shrink-0 rounded-full border border-border/60 bg-transparent px-2 text-xs text-text-secondary hover:bg-bg-hover/60 focus:border-accent/50 focus:outline-none"
            >
              <option value="">{t('scopeChips.agent')}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          )}
        </>
      ) : null}
    </div>
  )
}
