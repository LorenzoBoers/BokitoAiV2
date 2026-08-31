import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Label } from '../ui/label'
import { LoadingBlock } from '../ui/loading-block'
import { listAgents } from '../../lib/agents-api'
import {
  createChannelBinding,
  deleteChannelBinding,
  listChannelBindings,
  updateChannelBinding,
  type ChannelBinding,
} from '../../lib/channel-bindings-api'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { useAuth } from '../../context/AuthContext'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { inboxPath } from '../../lib/messages-paths'

// Only channels with a real adapter + connect path.
const CHANNELS = ['email', 'widget', 'slack', 'whatsapp'] as const

type AgentOption = { id: string; name: string }

export default function ChannelBindingsPanel() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [bindings, setBindings] = useState<ChannelBinding[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [accounts, setAccounts] = useState<ChannelAccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [channel, setChannel] = useState<string>('email')
  const [agentId, setAgentId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [priority, setPriority] = useState('10')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bindingRows, agentRows, accountRows] = await Promise.all([
        listChannelBindings(),
        listAgents().catch(() => [] as AgentOption[]),
        token ? listChannelAccounts(token).catch(() => [] as ChannelAccountRow[]) : Promise.resolve([]),
      ])
      setBindings(bindingRows)
      setAgents(agentRows.map((a) => ({ id: a.id, name: a.name })))
      setAccounts(accountRows)
      setAgentId((prev) => prev || agentRows[0]?.id || '')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('channelsPage.bindings.loadError')))
      setBindings([])
    } finally {
      setLoading(false)
    }
  }, [t, token])

  useEffect(() => {
    void load()
  }, [load])

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? t('workforce.agents.types.worker')
  const channelLabel = (value: string) => {
    if (value === 'email' || value === 'widget' || value === 'slack' || value === 'whatsapp') {
      return t(`channelsPage.bindings.${value}`)
    }
    return value
  }
  const scopeLabel = (row: ChannelBinding): string => {
    if (row.contact_id) return `${channelLabel(row.channel)} · ${t('channelsPage.bindings.contactScope')}`
    if (row.channel_account_id) {
      const account = accounts.find((a) => a.id === row.channel_account_id)
      const address = account ? account.address || account.displayName : '…'
      return t('channelsPage.bindings.accountScope', { address })
    }
    return channelLabel(row.channel)
  }

  const addBinding = async () => {
    if (!agentId) {
      toast.error(t('channelsPage.bindings.pickAgent'))
      return
    }
    setSaving(true)
    try {
      const parsedPriority = Number(priority)
      await createChannelBinding({
        channel,
        agent_id: agentId,
        channel_account_id: accountId || null,
        priority: Number.isFinite(parsedPriority) ? parsedPriority : 10,
        enabled: true,
      })
      toast.success(t('channelsPage.bindings.created'))
      setAccountId('')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('channelsPage.bindings.createError')))
    } finally {
      setSaving(false)
    }
  }

  const toggleBinding = async (row: ChannelBinding) => {
    setUpdatingId(row.id)
    try {
      const next = await updateChannelBinding(row.id, { enabled: !row.enabled })
      setBindings((prev) => prev.map((item) => (item.id === row.id ? next : item)))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('channelsPage.bindings.createError')))
    } finally {
      setUpdatingId(null)
    }
  }

  const removeBinding = async (id: string) => {
    if (!window.confirm(t('channelsPage.bindings.removeConfirm'))) return
    setRemovingId(id)
    try {
      await deleteChannelBinding(id)
      toast.success(t('channelsPage.bindings.removed'))
      setBindings((prev) => prev.filter((b) => b.id !== id))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('channelsPage.bindings.removeError')))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h2 className="text-sm font-medium text-text-heading">{t('channelsPage.bindings.title')}</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          {t('channelsPage.bindings.body')}
        </p>
        <p className="text-[11px] text-text-muted">{t('channelsPage.bindings.leadHint')}</p>
      </div>

      {loading ? (
        <LoadingBlock variant="inline" label={t('channelsPage.bindings.loading')} />
      ) : (
        <>
          {bindings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center">
              <p className="text-xs text-text-muted">
                {t('channelsPage.bindings.empty')}
              </p>
              {agents.length === 0 ? null : (
                <p className="mt-1.5 text-[11px] text-text-muted">{t('channelsPage.bindings.emptyHint')}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <Link to="/agents" className="text-xs font-medium text-accent hover:underline">
                  {t('channelsPage.bindings.openAgents')}
                </Link>
                <Link to={inboxPath('open')} className="text-xs font-medium text-accent hover:underline">
                  {t('channelsPage.bindings.openCommunication')}
                </Link>
                <Link to="/modules/marketplace" className="text-xs font-medium text-accent hover:underline">
                  {t('channelsPage.bindings.openMarketplace')}
                </Link>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {bindings.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-elevated/40 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-heading">
                      {scopeLabel(row)} → {agentName(row.agent_id)}
                    </p>
                    <p className="text-[11px] text-text-muted">
                      {t('channelsPage.bindings.priority', { priority: row.priority })}
                      {!row.enabled ? ` · ${t('channelsPage.bindings.disabled')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={updatingId === row.id}
                      onClick={() => void toggleBinding(row)}
                    >
                      {row.enabled ? t('channelsPage.bindings.pause') : t('channelsPage.bindings.enable')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={removingId === row.id}
                      onClick={() => void removeBinding(row.id)}
                      aria-label={t('channelsPage.bindings.removeAria')}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t border-border/60 pt-4">
            <Label className="text-xs">{t('channelsPage.bindings.add')}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value)
                  setAccountId('')
                }}
                className="h-8 rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs"
              >
                {CHANNELS.map((value) => (
                  <option key={value} value={value}>
                    {t(`channelsPage.bindings.${value}`)}
                  </option>
                ))}
              </select>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-8 min-w-[10rem] rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs"
                aria-label={t('channelsPage.bindings.accountOptional')}
              >
                <option value="">{t('channelsPage.bindings.allAccounts')}</option>
                {accounts
                  .filter((account) => account.channel === channel)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.address || account.displayName}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                min={0}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="h-8 w-16 rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs"
                aria-label={t('channelsPage.bindings.priorityLabel')}
                title={t('channelsPage.bindings.priorityLabel')}
              />
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="h-8 min-w-[10rem] flex-1 rounded-md border border-border/60 bg-bg-input/80 px-2 text-xs"
              >
                {agents.length === 0 ? (
                  <option value="">{t('channelsPage.bindings.noAgents')}</option>
                ) : (
                  agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))
                )}
              </select>
              <Button
                type="button"
                size="sm"
                disabled={saving || !agentId}
                onClick={() => void addBinding()}
              >
                {saving ? t('channelsPage.bindings.adding') : t('channelsPage.bindings.add')}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
