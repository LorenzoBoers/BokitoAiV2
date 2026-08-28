import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Check, ChevronRight, Copy, Mail, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import ProviderLogo from '../email/ProviderLogo'
import { BrandMark } from '../integrations/BrandMark'
import WhatsAppConnectForm from './WhatsAppConnectForm'
import SlackConnectForm from './SlackConnectForm'
import { useAuth } from '../../context/AuthContext'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  buildRelayAddress,
  createEmailRelay,
  getRelayOptions,
  normalizeRelayPrefix,
  type RelayOptions,
} from '../../lib/channels-api'
import { startOAuthConnection } from '../../lib/email-api'
import { WEBSITE_WIDGET_PATH } from '../../lib/assistant-settings-path'
import { cn } from '../../lib/utils'
import type { Provider } from '../../lib/email-oauth'

type Choice = 'menu' | 'email' | 'relay' | 'whatsapp' | 'slack'

const EMAIL_LOGOS = ['outlook', 'gmail', 'smtp_imap'] as const

export type AddChannelDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Refresh the channel list after a channel is added. */
  onChannelAdded: () => void
}

function IconTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-bg-elevated/80',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Overlapping brand chips so Email reads as “many providers” at a glance. */
function EmailLogoStack() {
  return (
    <span className="flex h-10 shrink-0 items-center pl-0.5">
      {EMAIL_LOGOS.map((logo, index) => (
        <span
          key={logo}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-elevated shadow-sm',
            index > 0 && '-ml-2.5',
          )}
          style={{ zIndex: EMAIL_LOGOS.length - index }}
        >
          <ProviderLogo provider={logo} className="h-[15px] w-[15px] object-contain" />
        </span>
      ))}
    </span>
  )
}

function ChoiceRow({
  onClick,
  disabled,
  icon,
  title,
  hint,
  trailing,
  className,
}: {
  onClick?: () => void
  disabled?: boolean
  icon: ReactNode
  title: string
  hint: string
  trailing?: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl border border-border/50 bg-bg-elevated/30 px-3 py-3 text-left transition-all',
        'hover:border-border hover:bg-bg-hover/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border/50 disabled:hover:bg-bg-elevated/30',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text-heading">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-text-secondary">{hint}</span>
      </span>
      {trailing ?? (
        <ChevronRight
          size={16}
          className="shrink-0 text-text-muted/70 transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary"
        />
      )}
    </button>
  )
}

function ProviderCard({
  onClick,
  disabled,
  icon,
  title,
  hint,
  badge,
}: {
  onClick?: () => void
  disabled?: boolean
  icon: ReactNode
  title: string
  hint: string
  badge?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative flex flex-col items-start gap-3 rounded-xl border border-border/50 bg-bg-elevated/30 p-3.5 text-left transition-all',
        'hover:border-border hover:bg-bg-hover/50 hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-border/50 disabled:hover:bg-bg-elevated/30 disabled:hover:shadow-none',
      )}
    >
      {badge ? (
        <span className="absolute right-2.5 top-2.5 rounded-full bg-bg-input px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
          {badge}
        </span>
      ) : null}
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-bg-surface">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-heading">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-text-secondary">{hint}</span>
      </span>
    </button>
  )
}

/**
 * One entry point for every channel type. Mailboxes go through OAuth, a Bokito
 * relay address is created here, WhatsApp and Slack use their credential forms,
 * and the website chat points at its design page (it already exists as a row).
 */
export default function AddChannelDialog({
  open,
  onOpenChange,
  onChannelAdded,
}: AddChannelDialogProps) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [choice, setChoice] = useState<Choice>('menu')
  const [connectBusy, setConnectBusy] = useState<'outlook' | 'gmail' | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [relayOptions, setRelayOptions] = useState<RelayOptions | null>(null)
  const [prefix, setPrefix] = useState('')
  const [relayBusy, setRelayBusy] = useState(false)
  const [relayError, setRelayError] = useState<string | null>(null)
  const [createdAddress, setCreatedAddress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setChoice('menu')
    setConnectBusy(null)
    setConnectError(null)
    setRelayError(null)
    setCreatedAddress(null)
    setPrefix('')
  }, [open])

  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    getRelayOptions(token)
      .then((options) => {
        if (!cancelled) setRelayOptions(options)
      })
      .catch(() => {
        // Non-blocking: the relay option shows without the counter.
      })
    return () => {
      cancelled = true
    }
  }, [open, token, createdAddress])

  const connectMailbox = useCallback(
    async (next: 'outlook' | 'gmail') => {
      if (!token || connectBusy) return
      setConnectBusy(next)
      setConnectError(null)
      try {
        const url = await startOAuthConnection(token, next)
        if (!url.trim()) {
          setConnectError(t('channelsPage.noAuthorizeUrl'))
          setConnectBusy(null)
          return
        }
        window.location.assign(url)
      } catch (err) {
        setConnectError(formatApiErrorMessage(err, t('channelsPage.connectError')))
        setConnectBusy(null)
      }
    },
    [token, connectBusy, t],
  )

  const createRelay = useCallback(async () => {
    if (!token || relayBusy) return
    setRelayBusy(true)
    setRelayError(null)
    try {
      const row = await createEmailRelay(token, { prefix })
      setCreatedAddress(row?.address ?? '')
      onChannelAdded()
    } catch (err) {
      setRelayError(formatApiErrorMessage(err, t('channelsPage.relay.createError')))
    } finally {
      setRelayBusy(false)
    }
  }, [token, relayBusy, prefix, onChannelAdded, t])

  const copyAddress = useCallback(async () => {
    if (!createdAddress) return
    try {
      await navigator.clipboard.writeText(createdAddress)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('channelsPage.copyAddressError'))
    }
  }, [createdAddress, t])

  const goBack = () => {
    setChoice(choice === 'relay' ? 'email' : 'menu')
    setConnectError(null)
  }

  const title =
    choice === 'email'
      ? t('channelsPage.option.email')
      : choice === 'relay'
        ? t('channelsPage.option.relay')
        : choice === 'whatsapp'
          ? t('channelsPage.option.whatsapp')
          : choice === 'slack'
            ? t('channelsPage.option.slack')
            : t('channelsPage.addChannel')

  const description =
    choice === 'email'
      ? t('channelsPage.email.pickDescription')
      : choice === 'relay'
        ? t('channelsPage.option.relayHint')
        : t('channelsPage.addChannelDescription')

  const relaysLeft = relayOptions ? relayOptions.maxRelays - relayOptions.used : null
  const preview = relayOptions
    ? buildRelayAddress(prefix, relayOptions.workspaceSlug, relayOptions.domain)
    : ''
  const cleanPrefix = normalizeRelayPrefix(prefix)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[520px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border/70 bg-bg-surface p-5 shadow-2xl">
          <div className="flex items-start gap-2.5">
            {choice !== 'menu' ? (
              <button
                type="button"
                onClick={goBack}
                aria-label={t('channelsPage.back')}
                className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <ArrowLeft size={15} />
              </button>
            ) : null}
            <div className="min-w-0">
              <Dialog.Title className="text-[17px] font-semibold tracking-tight text-text-heading">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12.5px] leading-snug text-text-secondary">
                {description}
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {choice === 'menu' ? (
              <div className="space-y-2">
                <ChoiceRow
                  onClick={() => setChoice('email')}
                  icon={<EmailLogoStack />}
                  title={t('channelsPage.option.email')}
                  hint={t('channelsPage.option.emailHint')}
                />
                <ChoiceRow
                  onClick={() => setChoice('whatsapp')}
                  icon={
                    <IconTile>
                      <BrandMark slug="whatsapp" size={18} />
                    </IconTile>
                  }
                  title={t('channelsPage.option.whatsapp')}
                  hint={t('whatsappCard.description')}
                />
                <ChoiceRow
                  onClick={() => setChoice('slack')}
                  icon={
                    <IconTile>
                      <BrandMark slug="slack" size={18} />
                    </IconTile>
                  }
                  title={t('channelsPage.option.slack')}
                  hint={t('slackCard.description')}
                />
                <Link
                  to={WEBSITE_WIDGET_PATH}
                  onClick={() => onOpenChange(false)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-border/50 bg-bg-elevated/30 px-3 py-3 text-left transition-all hover:border-border hover:bg-bg-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <IconTile className="text-text-secondary">
                    <MessageSquare size={16} />
                  </IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text-heading">
                      {t('channelsPage.option.widget')}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-text-secondary">
                      {t('channelsPage.option.widgetHint')}
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-text-muted/70 transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary"
                  />
                </Link>
              </div>
            ) : null}

            {choice === 'email' ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  {(['gmail', 'outlook'] as const).map((option) => (
                    <ProviderCard
                      key={option}
                      onClick={() => void connectMailbox(option)}
                      disabled={connectBusy !== null}
                      icon={
                        <ProviderLogo provider={option as Provider} className="h-5 w-5 object-contain" />
                      }
                      title={t(`channelsPage.email.${option}`)}
                      hint={
                        connectBusy === option
                          ? t('channelsPage.connecting')
                          : t('channelsPage.email.oauthShort')
                      }
                    />
                  ))}
                  <ProviderCard
                    disabled
                    icon={<ProviderLogo provider="smtp_imap" className="h-5 w-5 object-contain" />}
                    title={t('channelsPage.email.imap')}
                    hint={t('channelsPage.email.imapShort')}
                    badge={t('comingSoon')}
                  />
                  <ProviderCard
                    onClick={() => setChoice('relay')}
                    disabled={relaysLeft === 0 || connectBusy !== null}
                    icon={<Mail size={16} className="text-accent" />}
                    title={t('channelsPage.option.relay')}
                    hint={
                      relayOptions
                        ? t('channelsPage.relay.counter', {
                            used: relayOptions.used,
                            max: relayOptions.maxRelays,
                          })
                        : t('channelsPage.email.relayShort')
                    }
                  />
                </div>
                {connectError ? <p className="text-xs text-status-error">{connectError}</p> : null}
              </div>
            ) : null}

            {choice === 'relay' ? (
              createdAddress ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/50 bg-bg-elevated/40 px-4 py-4">
                    <p className="text-sm text-text-secondary">{t('channelsPage.relay.created')}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-lg border border-border/60 bg-bg-surface px-2.5 py-2 text-xs font-medium text-text-heading">
                        {createdAddress}
                      </code>
                      <Button variant="secondary" size="sm" onClick={() => void copyAddress()}>
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? t('channelsPage.copied') : t('channelsPage.copy')}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted">{t('channelsPage.relay.forwardingHint')}</p>
                  <div className="flex justify-end">
                    <Button onClick={() => onOpenChange(false)}>{t('channelsPage.done')}</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="flex flex-col gap-1.5 text-xs text-text-muted">
                    {t('channelsPage.relay.prefixLabel')}
                    <input
                      value={prefix}
                      onChange={(e) => setPrefix(e.target.value)}
                      placeholder={t('channelsPage.relay.prefixPlaceholder')}
                      autoFocus
                      className="rounded-lg border border-border/60 bg-bg-elevated/60 px-3 py-2 font-mono text-[12.5px] text-text-primary outline-none transition-colors focus:border-accent/60"
                    />
                  </label>
                  <div className="rounded-lg border border-dashed border-border/60 bg-bg-elevated/20 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-text-muted">
                      {t('channelsPage.relay.preview')}
                    </p>
                    <code className="mt-1 block truncate text-[12.5px] font-medium text-text-heading">
                      {preview || t('channelsPage.relay.previewEmpty')}
                    </code>
                  </div>
                  {relayOptions ? (
                    <p className="text-xs text-text-muted">
                      {t('channelsPage.relay.counter', {
                        used: relayOptions.used,
                        max: relayOptions.maxRelays,
                      })}
                    </p>
                  ) : null}
                  <p className="text-xs text-text-muted">{t('channelsPage.relay.forwardingHint')}</p>
                  {relayError ? <p className="text-xs text-status-error">{relayError}</p> : null}
                  <div className="flex justify-end">
                    <Button
                      disabled={relayBusy || cleanPrefix.length < 3}
                      onClick={() => void createRelay()}
                    >
                      {relayBusy ? t('channelsPage.relay.creating') : t('channelsPage.relay.create')}
                    </Button>
                  </div>
                </div>
              )
            ) : null}

            {choice === 'whatsapp' ? <WhatsAppConnectForm onConnected={onChannelAdded} /> : null}
            {choice === 'slack' ? <SlackConnectForm onConnected={onChannelAdded} /> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
