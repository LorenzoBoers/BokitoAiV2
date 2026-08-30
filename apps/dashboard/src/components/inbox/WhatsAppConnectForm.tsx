import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, Copy, ExternalLink } from 'lucide-react'
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
import { cn } from '../../lib/utils'

/** Meta developer console — WhatsApp product landing. */
const META_WHATSAPP_DOCS =
  'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started'

/**
 * Connect a WhatsApp Business number (Cloud API). V1 is bring-your-own Meta
 * app: paste a permanent System User token + phone number ID, then register
 * our webhook URL and verify token in the Meta App Dashboard.
 *
 * The form is a three-step guide so operators who are not Meta-fluent still
 * know where each value comes from and what to do after Connect.
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
  const activeStep = connected ? 3 : 2

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

  return (
    <div className="space-y-4">
      <StepRail
        steps={[
          t('whatsappCard.step1Title'),
          t('whatsappCard.step2Title'),
          t('whatsappCard.step3Title'),
        ]}
        active={activeStep}
        done={connected ? [1, 2] : []}
      />

      {!connected ? (
        <>
          <StepPanel
            number={1}
            title={t('whatsappCard.step1Title')}
            active={activeStep === 1}
          >
            <p className="text-[12.5px] leading-relaxed text-text-secondary">
              {t('whatsappCard.step1Body')}
            </p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[12.5px] leading-snug text-text-secondary">
              <li>{t('whatsappCard.step1ItemApp')}</li>
              <li>{t('whatsappCard.step1ItemNumber')}</li>
              <li>{t('whatsappCard.step1ItemIds')}</li>
              <li>{t('whatsappCard.step1ItemToken')}</li>
            </ol>
            <a
              href={META_WHATSAPP_DOCS}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline"
            >
              {t('whatsappCard.openMetaDocs')}
              <ExternalLink size={12} aria-hidden />
            </a>
          </StepPanel>

          <StepPanel
            number={2}
            title={t('whatsappCard.step2Title')}
            active={activeStep === 2}
          >
            <p className="mb-3 text-[12.5px] leading-relaxed text-text-secondary">
              {t('whatsappCard.step2Body')}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('whatsappCard.displayName')}
                hint={t('whatsappCard.displayNameHint')}
              >
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('whatsappCard.displayNamePlaceholder')}
                  className={fieldClass}
                />
              </Field>
              <Field
                label={t('whatsappCard.phoneNumberId')}
                hint={t('whatsappCard.phoneNumberIdHint')}
                required
              >
                <input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder={t('whatsappCard.phoneNumberIdPlaceholder')}
                  className={cn(fieldClass, 'font-mono')}
                  autoComplete="off"
                />
              </Field>
              <Field
                label={t('whatsappCard.wabaId')}
                hint={t('whatsappCard.wabaIdHint')}
              >
                <input
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  placeholder={t('whatsappCard.wabaIdPlaceholder')}
                  className={cn(fieldClass, 'font-mono')}
                  autoComplete="off"
                />
              </Field>
              <Field
                label={t('whatsappCard.accessToken')}
                hint={t('whatsappCard.accessTokenHint')}
                required
              >
                <input
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={t('whatsappCard.accessTokenPlaceholder')}
                  type="password"
                  autoComplete="off"
                  className={cn(fieldClass, 'font-mono')}
                />
              </Field>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-text-muted">
              {t('whatsappCard.tokenHint')}
            </p>
            {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
            <div className="mt-3 flex justify-end">
              <Button size="sm" disabled={busy} onClick={() => void connect()}>
                {busy ? t('whatsappCard.connecting') : t('whatsappCard.connectNumber')}
              </Button>
            </div>
          </StepPanel>
        </>
      ) : (
        <StepPanel
          number={3}
          title={t('whatsappCard.step3Title')}
          active
        >
          <p className="text-[12.5px] leading-relaxed text-text-secondary">
            {t('whatsappCard.step3Body')}
          </p>
          <div className="mt-3 space-y-2 rounded-lg border border-border/50 bg-bg-elevated/40 p-3">
            <CopyRow
              label={t('whatsappCard.webhookUrl')}
              value={webhookUrl}
              copied={copiedField === 'webhook'}
              onCopy={() => void copyValue('webhook', webhookUrl)}
              copyLabel={t('whatsappCard.copy')}
            />
            {setup?.verifyToken ? (
              <CopyRow
                label={t('whatsappCard.verifyToken')}
                value={setup.verifyToken}
                copied={copiedField === 'verify'}
                onCopy={() => void copyValue('verify', setup.verifyToken)}
                copyLabel={t('whatsappCard.copy')}
              />
            ) : (
              <p className="text-[12px] text-status-warning">{t('whatsappCard.verifyTokenMissing')}</p>
            )}
          </div>
          <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[12.5px] leading-snug text-text-secondary">
            <li>{t('whatsappCard.step3ItemPaste')}</li>
            <li>{t('whatsappCard.step3ItemSubscribe')}</li>
            <li>{t('whatsappCard.step3ItemTest')}</li>
          </ol>
          <a
            href={META_WHATSAPP_DOCS}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline"
          >
            {t('whatsappCard.openMetaConfig')}
            <ExternalLink size={12} aria-hidden />
          </a>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/40 pt-3">
            <Link to={inboxPath('open')} className="text-[12.5px] font-medium text-accent hover:underline">
              {t('whatsappCard.openCommunication')}
            </Link>
            <Link
              to="/settings/communication"
              className="text-[12.5px] font-medium text-accent hover:underline"
            >
              {t('whatsappCard.openInboxAi')}
            </Link>
          </div>
        </StepPanel>
      )}
    </div>
  )
}

const fieldClass =
  'rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60'

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      <span className="flex items-baseline gap-1 text-text-secondary">
        <span className="font-medium text-text-heading">{label}</span>
        {required ? <span className="text-status-error">*</span> : null}
      </span>
      {children}
      <span className="text-[11px] leading-snug text-text-muted">{hint}</span>
    </label>
  )
}

function StepRail({
  steps,
  active,
  done,
}: {
  steps: string[]
  active: number
  done: number[]
}) {
  return (
    <ol className="flex items-stretch gap-1.5" aria-label="WhatsApp setup">
      {steps.map((label, index) => {
        const number = index + 1
        const isDone = done.includes(number)
        const isActive = active === number
        const isOpen = number <= active
        return (
          <li
            key={label}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2',
              isActive
                ? 'border-accent/40 bg-accent/10'
                : isDone || isOpen
                  ? 'border-border/50 bg-bg-elevated/40'
                  : 'border-border/40 bg-transparent opacity-55',
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                isActive
                  ? 'bg-accent text-white'
                  : isDone
                    ? 'bg-accent/20 text-accent'
                    : isOpen
                      ? 'bg-bg-hover text-text-secondary'
                      : 'bg-bg-hover text-text-muted',
              )}
              aria-hidden
            >
              {isDone && !isActive ? <Check size={11} strokeWidth={2.5} /> : number}
            </span>
            <span
              className={cn(
                'min-w-0 truncate text-[11px] font-medium leading-tight',
                isActive || isOpen ? 'text-text-heading' : 'text-text-secondary',
              )}
            >
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function StepPanel({
  number,
  title,
  active,
  children,
}: {
  number: number
  title: string
  active?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'rounded-xl border p-3.5',
        active ? 'border-border/60 bg-bg-elevated/30' : 'border-border/40 bg-transparent',
      )}
    >
      <header className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
          {number}
        </span>
        <h3 className="text-[13px] font-semibold text-text-heading">{title}</h3>
      </header>
      {children}
    </section>
  )
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
  copyLabel,
}: {
  label: string
  value: string
  copied: boolean
  onCopy: () => void
  copyLabel: string
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="shrink-0 text-[11px] font-medium text-text-secondary">{label}</span>
      <code className="min-w-0 flex-1 break-all rounded bg-bg-input px-1.5 py-1 text-[11px] text-text-primary">
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
      >
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        <span>{copyLabel}</span>
      </button>
    </div>
  )
}
