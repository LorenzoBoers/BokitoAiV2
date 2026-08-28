import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { useAuth } from '../../context/AuthContext'
import { createSlackAccount } from '../../lib/channel-accounts-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

/**
 * Connect a Slack workspace so decision cards arrive as DMs with
 * Approve/Deny buttons. After connecting, the events URL must be registered
 * in the Slack app configuration.
 */
export default function SlackConnectForm({ onConnected }: { onConnected: () => void }) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [workspaceName, setWorkspaceName] = useState('')
  const [botToken, setBotToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [notifyChannelId, setNotifyChannelId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectedId, setConnectedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const interactionsUrl = `${window.location.origin}/api/channels/slack/interactions`
  const eventsUrl = connectedId
    ? `${window.location.origin}/api/channels/slack/events/${connectedId}`
    : ''

  const copyEventsUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(eventsUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('slackCard.couldNotCopy'))
    }
  }, [eventsUrl, t])

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
      setConnectedId(account.id)
      setWorkspaceName('')
      setBotToken('')
      setSigningSecret('')
      setNotifyChannelId('')
      toast.success(t('slackCard.connectedToast'))
      onConnected()
    } catch (e) {
      setError(formatApiErrorMessage(e, t('slackCard.couldNotConnect')))
    } finally {
      setBusy(false)
    }
  }, [token, busy, botToken, signingSecret, workspaceName, notifyChannelId, onConnected, t])

  if (connectedId) {
    return (
      <div className="space-y-1.5 text-xs text-text-muted">
        <p>{t('slackCard.finishSetup')}</p>
        <p className="flex items-center gap-1.5">
          <span className="font-medium text-text-secondary">{t('slackCard.eventsUrl')}</span>
          <code className="rounded bg-bg-input px-1 py-0.5 text-[11px]">{eventsUrl}</code>
          <button type="button" className="text-accent hover:underline" onClick={() => void copyEventsUrl()}>
            {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          </button>
        </p>
        <p>
          <span className="font-medium text-text-secondary">{t('slackCard.interactivityUrl')}</span>{' '}
          <code className="rounded bg-bg-input px-1 py-0.5 text-[11px]">{interactionsUrl}</code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
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
      <div className="flex justify-end">
        <Button size="sm" disabled={busy} onClick={() => void connect()}>
          {busy ? t('slackCard.connecting') : t('slackCard.connectWorkspace')}
        </Button>
      </div>
    </div>
  )
}
