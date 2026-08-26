import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { SettingsSection } from '../layout/SettingsSection'
import { useAuth } from '../../context/AuthContext'
import {
  createWhatsAppAccount,
  deleteChannelAccount,
  getWhatsAppSetup,
  listChannelAccounts,
  type ChannelAccountRow,
  type WhatsAppSetupInfo,
} from '../../lib/channel-accounts-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import AgentBindingPicker from '../settings/AgentBindingPicker'
import ChannelVisibilityPicker from '../settings/ChannelVisibilityPicker'
import { BrandMark, BrandTile } from '../integrations/BrandMark'

/**
 * Connect a WhatsApp Business number (Cloud API) so customer messages land in
 * the inbox. V1 is bring-your-own Meta app: the tenant pastes a permanent
 * System User access token + phone number ID, then registers our app-level
 * webhook URL and verify token in the Meta App Dashboard.
 */
export default function WhatsAppConnectCard() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [accounts, setAccounts] = useState<ChannelAccountRow[]>([])
  const [setup, setSetup] = useState<WhatsAppSetupInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [connectedAccountId, setConnectedAccountId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [rows, setupInfo] = await Promise.all([
        listChannelAccounts(token),
        getWhatsAppSetup(token).catch(() => null),
      ])
      setAccounts(rows.filter((r) => r.channel === 'whatsapp'))
      setSetup(setupInfo)
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
    if (!phoneNumberId.trim() || !accessToken.trim()) {
      setError(t('whatsappCard.required'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const account = await createWhatsAppAccount(token, {
        displayName: displayName.trim() || t('whatsappCard.numberFallback'),
        phoneNumberId: phoneNumberId.trim(),
        accessToken: accessToken.trim(),
        wabaId: wabaId.trim(),
      })
      setConnectedAccountId(account.id)
      setFormOpen(false)
      setDisplayName('')
      setPhoneNumberId('')
      setWabaId('')
      setAccessToken('')
      toast.success(t('whatsappCard.connectedToast'))
      await load()
    } catch (e) {
      setError(formatApiErrorMessage(e, t('whatsappCard.couldNotConnect')))
    } finally {
      setBusy(false)
    }
  }, [token, busy, phoneNumberId, accessToken, displayName, wabaId, load, t])

  const remove = useCallback(
    async (accountId: string) => {
      if (!token) return
      if (!window.confirm(t('whatsappCard.disconnectConfirm'))) return
      try {
        await deleteChannelAccount(token, accountId)
        toast.success(t('whatsappCard.disconnectedToast'))
        await load()
      } catch (e) {
        toast.error(formatApiErrorMessage(e, t('whatsappCard.couldNotDisconnect')))
      }
    },
    [token, load, t],
  )

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

  const webhookUrl = setup?.webhookUrl || `${window.location.origin}/api/channels/whatsapp/webhook`

  return (
    <div id="whatsapp" className="scroll-mt-6">
    <SettingsSection
      title={t('whatsappCard.title')}
      description={t('whatsappCard.description')}
      icon={<BrandTile slug="whatsapp" />}
      actions={
        accounts.length === 0 && !formOpen ? (
          <Button variant="secondary" size="sm" onClick={() => setFormOpen(true)}>
            <BrandMark slug="whatsapp" className="mr-1.5" />
            {t('whatsappCard.connect')}
          </Button>
        ) : null
      }
    >
      {loading ? (
        <p className="text-sm text-text-muted">{t('whatsappCard.loading')}</p>
      ) : accounts.length === 0 && !formOpen ? (
        <p className="text-sm text-text-muted">{t('whatsappCard.empty')}</p>
      ) : null}

      {accounts.map((account) => (
        <div
          key={account.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-input/45 px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BrandMark slug="whatsapp" />
              <span className="truncate text-sm font-medium text-text-primary">
                {account.displayName || t('whatsappCard.numberFallback')}
              </span>
              <Badge variant={account.isEnabled ? 'success' : 'neutral'}>
                {account.isEnabled ? t('whatsappCard.connected') : t('whatsappCard.disabled')}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('whatsappCard.phoneNumberId')}: <code className="text-[11px]">{account.address}</code>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-text-muted">{t('bindingPicker.ariaLabel')}</span>
              <AgentBindingPicker channel="whatsapp" channelAccountId={account.id} />
              <ChannelVisibilityPicker accountId={account.id} visibility={account.visibility} />
            </div>
            {connectedAccountId === account.id ? (
              <div className="mt-2 space-y-1 text-xs text-text-muted">
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
              {t('whatsappCard.cancel')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void connect()}>
              {busy ? t('whatsappCard.connecting') : t('whatsappCard.connectNumber')}
            </Button>
          </div>
        </div>
      ) : null}
    </SettingsSection>
    </div>
  )
}
