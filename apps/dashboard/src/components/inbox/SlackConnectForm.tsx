import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { useAuth } from '../../context/AuthContext'
import { createSlackAccount } from '../../lib/channel-accounts-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { inboxPath } from '../../lib/messages-paths'
import { AUTONOMY_PATH } from '../../lib/navigation'
import { TextLink } from '../ui/text-link'
import { Input } from '../ui/input'

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
          <code className="rounded bg-bg-input px-1 py-0.5 text-xs">{eventsUrl}</code>
          <TextLink type="button" onClick={() => void copyEventsUrl()}>
            {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          </TextLink>
        </p>
        <p>
          <span className="font-medium text-text-secondary">{t('slackCard.interactivityUrl')}</span>{' '}
          <code className="rounded bg-bg-input px-1 py-0.5 text-xs">{interactionsUrl}</code>
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
          <Link to={inboxPath('open')} className="font-medium text-accent hover:underline">
            {t('slackCard.openCommunication')}
          </Link>
          <Link to={AUTONOMY_PATH} className="font-medium text-accent hover:underline">
            {t('slackCard.openInboxAi')}
          </Link>
          <Link to="/settings/govern?tab=policy" className="font-medium text-accent hover:underline">
            {t('slackCard.openGovern')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t('slackCard.workspaceName')}
          <Input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder={t('slackCard.workspaceNamePlaceholder')}
            className="h-8"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t('slackCard.notifyChannel')}
          <Input
            value={notifyChannelId}
            onChange={(e) => setNotifyChannelId(e.target.value)}
            placeholder={t('slackCard.notifyChannelPlaceholder')}
            className="h-8"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t('slackCard.botToken')}
          <Input
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={t('slackCard.botTokenPlaceholder')}
            type="password"
            autoComplete="off"
            className="h-8 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t('slackCard.signingSecret')}
          <Input
            value={signingSecret}
            onChange={(e) => setSigningSecret(e.target.value)}
            placeholder={t('slackCard.signingPlaceholder')}
            type="password"
            autoComplete="off"
            className="h-8 font-mono"
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
