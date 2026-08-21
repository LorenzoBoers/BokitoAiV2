import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Slack, Trash2 } from 'lucide-react'
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

/**
 * Connect a Slack workspace so decision cards can be delivered as DMs with
 * Approve/Deny buttons. The backend adapter and interaction endpoints exist;
 * this card is the missing management surface.
 */
export default function SlackConnectCard() {
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
      setError('Bot token and signing secret are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const account = await createSlackAccount(token, {
        workspaceName: workspaceName.trim() || 'Slack workspace',
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
      toast.success('Slack workspace connected')
      await load()
    } catch (e) {
      setError(formatApiErrorMessage(e, 'Could not connect Slack.'))
    } finally {
      setBusy(false)
    }
  }, [token, busy, botToken, signingSecret, workspaceName, notifyChannelId, load])

  const remove = useCallback(
    async (accountId: string) => {
      if (!token) return
      if (!window.confirm('Disconnect this Slack workspace? Decision DMs will stop.')) return
      try {
        await deleteChannelAccount(token, accountId)
        toast.success('Slack workspace disconnected')
        await load()
      } catch (e) {
        toast.error(formatApiErrorMessage(e, 'Could not disconnect Slack.'))
      }
    },
    [token, load],
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
      toast.error('Could not copy. Copy the URL manually.')
    }
  }, [])

  return (
    <SettingsSection
      title="Slack"
      description="Deliver decision cards as Slack messages with Approve and Deny buttons."
      actions={
        accounts.length === 0 && !formOpen ? (
          <Button variant="secondary" size="sm" onClick={() => setFormOpen(true)}>
            <Slack size={14} className="mr-1.5" aria-hidden />
            Connect Slack
          </Button>
        ) : null
      }
    >
      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : accounts.length === 0 && !formOpen ? (
        <p className="text-sm text-text-muted">
          No Slack workspace connected. Create a Slack app with the scopes{' '}
          <code className="rounded bg-bg-input px-1 py-0.5 text-[11px]">chat:write</code>,{' '}
          <code className="rounded bg-bg-input px-1 py-0.5 text-[11px]">users:read</code> and{' '}
          <code className="rounded bg-bg-input px-1 py-0.5 text-[11px]">users:read.email</code>,
          then connect it here with the bot token and signing secret.
        </p>
      ) : null}

      {accounts.map((account) => (
        <div
          key={account.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-input/45 px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Slack size={14} className="shrink-0 text-text-muted" aria-hidden />
              <span className="truncate text-sm font-medium text-text-primary">
                {account.displayName || 'Slack workspace'}
              </span>
              <Badge variant={account.isEnabled ? 'success' : 'neutral'}>
                {account.isEnabled ? 'Connected' : 'Disabled'}
              </Badge>
            </div>
            {connectedAccountId === account.id ? (
              <div className="mt-2 space-y-1 text-xs text-text-muted">
                <p>
                  Finish setup in your Slack app config (both URLs, shown once here but stable):
                </p>
                <p className="flex items-center gap-1.5">
                  <span className="font-medium text-text-secondary">Events URL:</span>
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
                  <span className="font-medium text-text-secondary">Interactivity URL:</span>{' '}
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
              Workspace name
              <input
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Acme Inc"
                className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Fallback notify channel ID (optional)
              <input
                value={notifyChannelId}
                onChange={(e) => setNotifyChannelId(e.target.value)}
                placeholder="C0123456789"
                className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Bot token
              <input
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="xoxb-..."
                type="password"
                autoComplete="off"
                className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 font-mono text-[12.5px] text-text-primary outline-none focus:border-accent/60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Signing secret
              <input
                value={signingSecret}
                onChange={(e) => setSigningSecret(e.target.value)}
                placeholder="Signing secret from Basic Information"
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
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void connect()}>
              {busy ? 'Connecting…' : 'Connect workspace'}
            </Button>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  )
}
