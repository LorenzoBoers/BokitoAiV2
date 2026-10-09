import { useEffect, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowRight, Check, Copy, Star, Wifi } from 'lucide-react'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { ChannelSetting } from './ChannelSetting'
import { CHANNEL_SYNC_WINDOW_OPTIONS } from '../inbox/MailboxSyncWindowField'
import {
  channelSettingsPath,
  type ChannelKind,
  type ChannelRow,
} from '../../lib/channels-api'
import { useAuth } from '../../context/AuthContext'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { getConnectionSignature, type SignatureSource } from '../../lib/email-api'
import type { ChannelActions } from './channel-actions'

type KindSettingsProps = {
  row: ChannelRow
  busy: boolean
  actions: ChannelActions
}

function checkDetail(row: ChannelRow, id: string): string {
  return row.checks.find((check) => check.id === id)?.detail ?? ''
}

function CopyAddress({ address }: { address: string }) {
  const { t } = useTranslation('nav')
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        } catch {
          toast.error(t('channelsPage.copyAddressError'))
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? t('channelsPage.copied') : t('channelsPage.copy')}
    </Button>
  )
}

function SignatureSetting({ row, busy, actions }: KindSettingsProps) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { connections } = useMailboxConnections()
  const [source, setSource] = useState<SignatureSource>('mailbox')

  useEffect(() => {
    if (!token) return
    const match = connections.find((connection) => connection.uuid === row.id)
    if (!match) return
    let cancelled = false
    void getConnectionSignature(token, match.id)
      .then((cfg) => {
        if (!cancelled) setSource(cfg.signatureSource)
      })
      .catch(() => {
        /* keep default */
      })
    return () => {
      cancelled = true
    }
  }, [token, connections, row.id])

  return (
    <>
      <ChannelSetting
        label={t('channelsPage.signatureSource')}
        hint={t('channelsPage.signatureSourceHint')}
      >
        <Select
          value={source}
          disabled={busy}
          onValueChange={(value) => {
            const next: SignatureSource = value === 'sender' ? 'sender' : 'mailbox'
            setSource(next)
            actions.setSignatureSource(row, next)
          }}
        >
          <SelectTrigger className="h-8 w-auto min-w-[11rem] text-xs" aria-label={t('channelsPage.signatureSource')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mailbox">{t('channelsPage.signatureSourceMailbox')}</SelectItem>
            <SelectItem value="sender">{t('channelsPage.signatureSourceSender')}</SelectItem>
          </SelectContent>
        </Select>
      </ChannelSetting>
      <ChannelSetting
        label={t('channelsPage.signature')}
        hint={
          source === 'sender'
            ? t('channelsPage.signatureHintSender')
            : t('channelsPage.signatureHint')
        }
      >
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => actions.editSignature(row)}>
          {t('channelsPage.edit')}
        </Button>
      </ChannelSetting>
    </>
  )
}

function PrimarySetting({ row, busy, actions }: KindSettingsProps) {
  const { t } = useTranslation('nav')
  return (
    <ChannelSetting label={t('channelsPage.primarySender')} hint={t('channelsPage.primarySenderHint')}>
      {row.isPrimary ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-success">
          <Star size={13} />
          {t('channelsPage.primary')}
        </span>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !row.isEnabled}
          onClick={() => actions.makePrimary(row)}
        >
          {t('channelsPage.makePrimary')}
        </Button>
      )}
    </ChannelSetting>
  )
}

function ReconnectSetting({ row, actions }: KindSettingsProps) {
  const { t } = useTranslation('nav')
  return (
    <ChannelSetting label={t('channelsPage.connection')} hint={t('channelsPage.connectionHint')}>
      <Button variant="secondary" size="sm" onClick={() => actions.reconnect(row)}>
        <Wifi size={13} />
        {t('channelsPage.reconnect')}
      </Button>
    </ChannelSetting>
  )
}

function LinkSetting({ label, hint, to }: { label: string; hint: string; to: string }) {
  const { t } = useTranslation('nav')
  return (
    <ChannelSetting label={label} hint={hint}>
      <Button asChild variant="secondary" size="sm">
        <Link to={to}>
          {t('channelsPage.open')}
          <ArrowRight size={12} />
        </Link>
      </Button>
    </ChannelSetting>
  )
}

function MailboxSettings(props: KindSettingsProps) {
  const { row, busy, actions } = props
  const { t } = useTranslation('nav')
  const folders = checkDetail(row, 'folders')
  return (
    <>
      <ChannelSetting label={t('channelsPage.folders')} hint={folders || t('channelsPage.foldersHint')}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => actions.editFolders(row)}
          data-testid="mailbox-folders-edit"
        >
          {t('channelsPage.edit')}
        </Button>
      </ChannelSetting>
      <SignatureSetting {...props} />
      <PrimarySetting {...props} />
      <ChannelSetting label={t('channelsPage.history')} hint={t('channelsPage.historyAdvancedHint')}>
        <Select
          value={String(row.syncWindowDays)}
          disabled={busy}
          onValueChange={(value) => actions.setSyncWindow(row, Number(value))}
        >
          <SelectTrigger className="h-8 w-auto min-w-[8rem] text-xs" aria-label={t('channelsPage.historyAria')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNEL_SYNC_WINDOW_OPTIONS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {days === 0
                  ? t('channelsPage.everything')
                  : days === 365
                    ? t('channelsPage.oneYear')
                    : t('channelsPage.days', { count: days })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ChannelSetting>
      <ChannelSetting
        label={t('channelsPage.archiveAutomated')}
        hint={t('channelsPage.archiveAutomatedHint')}
      >
        <Switch
          checked={row.archiveAutomatedMail}
          disabled={busy}
          onCheckedChange={(checked) => actions.setArchiveAutomatedMail(row, checked)}
          aria-label={t('channelsPage.archiveAutomated')}
          data-testid="mailbox-archive-automated"
        />
      </ChannelSetting>
      <ReconnectSetting {...props} />
    </>
  )
}

function RelaySettings(props: KindSettingsProps) {
  const { row } = props
  const { t } = useTranslation('nav')
  return (
    <>
      <ChannelSetting label={t('channelsPage.address')} hint={row.address}>
        <CopyAddress address={row.address} />
      </ChannelSetting>
      <SignatureSetting {...props} />
      <PrimarySetting {...props} />
    </>
  )
}

function WidgetSettings({ row }: KindSettingsProps) {
  const { t } = useTranslation('nav')
  return (
    <>
      <LinkSetting
        label={t('channelsPage.widgetDesign')}
        hint={t('channelsPage.widgetDesignHint')}
        to={channelSettingsPath(row.id, 'look')}
      />
      <LinkSetting
        label={t('channelsPage.widgetLive')}
        hint={t('channelsPage.widgetLiveHint')}
        to={channelSettingsPath(row.id, 'hours')}
      />
      <LinkSetting
        label={t('channelsPage.widgetInstall')}
        hint={t('channelsPage.widgetInstallHint')}
        to={channelSettingsPath(row.id, 'install')}
      />
    </>
  )
}

function WhatsAppSettings(props: KindSettingsProps) {
  const { t } = useTranslation('nav')
  return (
    <>
      {props.row.address ? (
        <ChannelSetting label={t('channelsPage.phoneNumber')} hint={props.row.address} />
      ) : null}
      <ReconnectSetting {...props} />
    </>
  )
}

/**
 * Type-specific settings, one component per channel kind. Mirrors the
 * backend `_RESOLVERS` registry: adding a kind means adding one entry here.
 */
export const CHANNEL_KIND_SETTINGS: Partial<Record<ChannelKind, ComponentType<KindSettingsProps>>> = {
  email_mailbox: MailboxSettings,
  email_relay: RelaySettings,
  widget: WidgetSettings,
  whatsapp: WhatsAppSettings,
  slack: ReconnectSetting,
}
