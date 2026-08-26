import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { SettingsSection } from '../layout/SettingsSection'
import { useAuth } from '../../context/AuthContext'
import {
  createSlackAccount,
  deleteChannelAccount,
  listChannelAccounts,
  type ChannelAccountRow,
} from '../../lib/channel-accounts-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import AgentBindingPicker from '../settings/AgentBindingPicker'
import ChannelVisibilityPicker from '../settings/ChannelVisibilityPicker'
import { BrandMark, BrandTile } from '../integrations/BrandMark'

/**
 * Connect a Slack workspace so decision cards can be delivered as DMs with
 * Approve/Deny buttons. The backend adapter and interaction endpoints exist;
 * this card is the missing management surface.
 */
export default function SlackConnectCard() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [accounts, setAccounts] = useState<ChannelAccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')
  const [botToken, setBotToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [notifyChannelId, setNotifyChannelId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [eventsUrlCopied, setEventsUrlCopied] = useState(false)
  const [connectedAccountId, setConnectedAccountId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const rows = await listChannelAccounts(token)
      setAccounts(rows.filter((r) => r.channel === 'slack'))
    } catch {
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const connect = useCallback(async () => {
    if (!token || busy) return
    if (!botToken.trim() || !signingSecret.trim()) {
      setError(t('slackCard.required'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const account = await createSlackAccount(token, {
        workspaceName: workspaceName.trim() || t('slackCard.workspace'),
        botToken: botToken.trim(),
        signingSecret: signingSecret.trim(),
        notifyChannelId: notifyChannelId.trim(),
      })
      setConnectedAccountId(account.id)
      setFormOpen(false)
      setWorkspaceName('')
      setBotToken('')
      setSigningSecret('')
      setNotifyChannelId('')
      toast.success(t('slackCard.connectedToast'))
      await load()
    } catch (e) {
      setError(formatApiErrorMessage(e, t('slackCard.couldNotConnect')))
    } finally {
      setBusy(false)
    }
  }, [token, busy, botToken, signingSecret, workspaceName, notifyChannelId, load, t])

  const remove = useCallback(
    async (accountId: string) => {
      if (!token) return
      if (!window.confirm(t('slackCard.disconnectConfirm'))) return
      try {
        await deleteChannelAccount(token, accountId)
        toast.success(t('slackCard.disconnectedToast'))
        await load()
      } catch (e) {
        toast.error(formatApiErrorMessage(e, t('slackCard.couldNotDisconnect')))
      }
    },
    [token, load, t],
  )

  const eventsUrlFor = (accountId: string) =>
    `${window.location.origin}/api/channels/slack/events/${accountId}`
  const interactionsUrl = `${window.location.origin}/api/channels/slack/interactions`

  const copyEventsUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setEventsUrlCopied(true)
      window.setTimeout(() => setEventsUrlCopied(false), 2000)
    } catch {
      toast.error(t('slackCard.couldNotCopy'))
    }
  }, [t])

  return (
    <SettingsSection
      title={t('slackCard.title')}
      description={t('slackCard.description')}
      icon={<BrandTile slug="slack" />}
      actions={
        accounts.length === 0 && !formOpen ? (
          <Button variant="secondary" size="sm" onClick={() => setFormOpen(true)}>
            <BrandMark slug="slack" className="mr-1.5" />
            {t('slackCard.connect')}
          </Button>
        ) : null
      }
    >
      {loading ? (
        <p className="text-sm text-text-muted">{t('slackCard.loading')}</p>
      ) : accounts.length === 0 && !formOpen ? (
        <p className="text-sm text-text-muted">
          {t('slackCard.empty')}
        </p>
      ) : null}

      {accounts.map((account) => (
        <div
          key={account.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-input/45 px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BrandMark slug="slack" />
              <span className="truncate text-sm font-medium text-text-primary">
                {account.displayName || t('slackCard.workspace')}
              </span>
              <Badge variant={account.isEnabled ? 'success' : 'neutral'}>
                {account.isEnabled ? t('slackCard.connected') : t('slackCard.disabled')}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-text-muted">{t('bindingPicker.ariaLabel')}</span>
              <AgentBindingPicker channel="slack" channelAccountId={account.id} />
              <ChannelVisibilityPicker accountId={account.id} visibility={account.visibility} />
            </div>
            {connectedAccountId === account.id ? (
              <div className="mt-2 space-y-1 text-xs text-text-muted">
                <p>
                  {t('slackCard.finishSetup')}
                </p>
                <p className="flex items-center gap-1.5">
                  <span className="font-medium text-text-secondary">{t('slackCard.eventsUrl')}</span>
                  <code className="rounded bg-bg-input px-1 py-0.5 text-[11px]">
                    {eventsUrlFor(account.id)}
                  </code>
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => void copyEventsUrl(eventsUrlFor(account.id))}
                  >
                    {eventsUrlCopied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
                  </button>
                </p>
                <p>
                  <span className="font-medium text-text-secondary">{t('slackCard.interactivityUrl')}</span>{' '}
                  <code className="rounded bg-bg-input px-1 py-0.5 text-[11px]">{interactionsUrl}</code>
                </p>
              </div>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-status-error hover:text-status-error"
            onClick={() => void remove(account.id)}
          >
            <Trash2 size={14} aria-hidden />
          </Button>
        </div>
      ))}

      {formOpen ? (
        <div className="space-y-3 rounded-lg border border-border/60 bg-bg-input/45 p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              {t('slackCard.workspaceName')}
              <input
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder={t('slackCard.workspaceNamePlaceholder')}
                className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              {t('slackCard.notifyChannel')}
              <input
                value={notifyChannelId}
                onChange={(e) => setNotifyChannelId(e.target.value)}
                placeholder={t('slackCard.notifyChannelPlaceholder')}
                className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              {t('slackCard.botToken')}
              <input
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={t('slackCard.botTokenPlaceholder')}
                type="password"
                autoComplete="off"
                className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 font-mono text-[12.5px] text-text-primary outline-none focus:border-accent/60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              {t('slackCard.signingSecret')}
              <input
                value={signingSecret}
                onChange={(e) => setSigningSecret(e.target.value)}
                placeholder={t('slackCard.signingPlaceholder')}
                type="password"
                autoComplete="off"
                className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 font-mono text-[12.5px] text-text-primary outline-none focus:border-accent/60"
              />
            </label>
          </div>
          {error ? <p className="text-xs text-status-error">{error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setFormOpen(false)
                setError(null)
              }}
            >
              {t('slackCard.cancel')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void connect()}>
              {busy ? t('slackCard.connecting') : t('slackCard.connectWorkspace')}
            </Button>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  )
}
