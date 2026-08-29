import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { useAuth } from '../../context/AuthContext'
import {
  createWhatsAppAccount,
  getWhatsAppSetup,
  type WhatsAppSetupInfo,
} from '../../lib/channel-accounts-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { inboxPath } from '../../lib/messages-paths'

/**
 * Connect a WhatsApp Business number (Cloud API). V1 is bring-your-own Meta
 * app: paste a permanent System User token + phone number ID, then register
 * our webhook URL and verify token in the Meta App Dashboard.
 */
export default function WhatsAppConnectForm({ onConnected }: { onConnected: () => void }) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [setup, setSetup] = useState<WhatsAppSetupInfo | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    getWhatsAppSetup(token)
      .then((info) => {
        if (!cancelled) setSetup(info)
      })
      .catch(() => {
        // Non-blocking: the webhook hint falls back to the current origin.
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const webhookUrl = setup?.webhookUrl || `${window.location.origin}/api/channels/whatsapp/webhook`

  const copyValue = useCallback(
    async (field: string, value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        setCopiedField(field)
        window.setTimeout(() => setCopiedField(null), 2000)
      } catch {
        toast.error(t('whatsappCard.couldNotCopy'))
      }
    },
    [t],
  )

  const connect = useCallback(async () => {
    if (!token || busy) return
    if (!phoneNumberId.trim() || !accessToken.trim()) {
      setError(t('whatsappCard.required'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createWhatsAppAccount(token, {
        displayName: displayName.trim() || t('whatsappCard.numberFallback'),
        phoneNumberId: phoneNumberId.trim(),
        accessToken: accessToken.trim(),
        wabaId: wabaId.trim(),
      })
      setConnected(true)
      setDisplayName('')
      setPhoneNumberId('')
      setWabaId('')
      setAccessToken('')
      toast.success(t('whatsappCard.connectedToast'))
      onConnected()
    } catch (e) {
      setError(formatApiErrorMessage(e, t('whatsappCard.couldNotConnect')))
    } finally {
      setBusy(false)
    }
  }, [token, busy, phoneNumberId, accessToken, displayName, wabaId, onConnected, t])

  if (connected) {
    return (
      <div className="space-y-1.5 text-xs text-text-muted">
        <p>{t('whatsappCard.finishSetup')}</p>
        <p className="flex items-center gap-1.5">
          <span className="font-medium text-text-secondary">{t('whatsappCard.webhookUrl')}</span>
          <code className="rounded bg-bg-input px-1 py-0.5 text-[11px]">{webhookUrl}</code>
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => void copyValue('webhook', webhookUrl)}
          >
            {copiedField === 'webhook' ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          </button>
        </p>
        {setup?.verifyToken ? (
          <p className="flex items-center gap-1.5">
            <span className="font-medium text-text-secondary">{t('whatsappCard.verifyToken')}</span>
            <code className="rounded bg-bg-input px-1 py-0.5 text-[11px]">{setup.verifyToken}</code>
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => void copyValue('verify', setup.verifyToken)}
            >
              {copiedField === 'verify' ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
            </button>
          </p>
        ) : (
          <p>{t('whatsappCard.verifyTokenMissing')}</p>
        )}
        <p>{t('whatsappCard.subscribeHint')}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
          <Link to={inboxPath('open')} className="font-medium text-accent hover:underline">
            {t('whatsappCard.openCommunication')}
          </Link>
          <Link to="/settings/communication" className="font-medium text-accent hover:underline">
            {t('whatsappCard.openInboxAi')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t('whatsappCard.displayName')}
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('whatsappCard.displayNamePlaceholder')}
            className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t('whatsappCard.phoneNumberId')}
          <input
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            placeholder={t('whatsappCard.phoneNumberIdPlaceholder')}
            className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 font-mono text-[12.5px] text-text-primary outline-none focus:border-accent/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t('whatsappCard.wabaId')}
          <input
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            placeholder={t('whatsappCard.wabaIdPlaceholder')}
            className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 font-mono text-[12.5px] text-text-primary outline-none focus:border-accent/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t('whatsappCard.accessToken')}
          <input
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={t('whatsappCard.accessTokenPlaceholder')}
            type="password"
            autoComplete="off"
            className="rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 font-mono text-[12.5px] text-text-primary outline-none focus:border-accent/60"
          />
        </label>
      </div>
      <p className="text-xs text-text-muted">{t('whatsappCard.tokenHint')}</p>
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <div className="flex justify-end">
        <Button size="sm" disabled={busy} onClick={() => void connect()}>
          {busy ? t('whatsappCard.connecting') : t('whatsappCard.connectNumber')}
        </Button>
      </div>
    </div>
  )
}
