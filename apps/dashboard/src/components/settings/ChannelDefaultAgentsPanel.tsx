import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Card } from '../ui/card'
import { LoadingBlock } from '../ui/loading-block'
import { useAuth } from '../../context/AuthContext'
import { listAgents } from '../../lib/agents-api'
import {
  listChannelAccounts,
  updateChannelDefaultAgent,
  type ChannelAccountRow,
} from '../../lib/channel-accounts-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

type AgentOption = { id: string; name: string }

export default function ChannelDefaultAgentsPanel() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [accounts, setAccounts] = useState<ChannelAccountRow[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [accountRows, agentRows] = await Promise.all([
        listChannelAccounts(token),
        listAgents(),
      ])
      setAccounts(accountRows)
      setAgents(agentRows.map(({ id, name }) => ({ id, name })))
    } catch (error) {
      toast.error(formatApiErrorMessage(error, t('channelsPage.bindings.loadError')))
    } finally {
      setLoading(false)
    }
  }, [t, token])

  useEffect(() => {
    void load()
  }, [load])

  const update = async (account: ChannelAccountRow, agentId: string) => {
    if (!token) return
    setSavingId(account.id)
    try {
      const changed = await updateChannelDefaultAgent(token, account.id, agentId || null)
      if (changed) {
        setAccounts((rows) => rows.map((row) => (row.id === account.id ? changed : row)))
      }
      toast.success(t('channelsPage.bindings.created'))
    } catch (error) {
      toast.error(formatApiErrorMessage(error, t('channelsPage.bindings.createError')))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-medium text-text-heading">{t('channelsPage.bindings.title')}</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          A conversation keeps its pinned agent. New conversations use the default agent for this channel.
        </p>
      </div>
      {loading ? (
        <LoadingBlock variant="inline" label={t('channelsPage.bindings.loading')} />
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <label
              key={account.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-text-heading">
                  {account.displayName || account.address}
                </span>
                <span className="text-[11px] capitalize text-text-muted">{account.channel}</span>
              </span>
              <select
                value={account.defaultAgentId ?? ''}
                disabled={savingId === account.id}
                onChange={(event) => void update(account, event.target.value)}
                className="h-8 min-w-[12rem] rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs"
              >
                <option value="">No default agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {accounts.length === 0 ? (
            <p className="text-xs text-text-muted">{t('channelsPage.bindings.empty')}</p>
          ) : null}
        </div>
      )}
    </Card>
  )
}
