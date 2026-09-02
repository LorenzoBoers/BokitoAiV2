import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { useAuth } from '../../context/AuthContext'
import {
  createSmtpImapAccount,
  deleteChannelAccount,
  verifySmtpImapAccount,
} from '../../lib/channel-accounts-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { inboxPath } from '../../lib/messages-paths'
import { cn } from '../../lib/utils'

/**
 * Connect any mailbox via IMAP (receive) + SMTP (send). Three-step guide:
 * prepare the provider, enter host/credentials, then live-verify.
 */
export default function SmtpImapConnectForm({ onConnected }: { onConnected: () => void }) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [imapSsl, setImapSsl] = useState(true)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpMode, setSmtpMode] = useState<'starttls' | 'ssl'>('starttls')
  const [sameHost, setSameHost] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  const activeStep: number = connected ? 3 : 2

  const connect = useCallback(async () => {
    if (!token || busy) return
    const address = email.trim()
    const user = (username.trim() || address).trim()
    if (!address || !user || !password || !imapHost.trim()) {
      setError(t('channelsPage.email.smtp.required'))
      return
    }
    const smtpHostValue = sameHost ? imapHost.trim() : smtpHost.trim()
    if (!smtpHostValue) {
      setError(t('channelsPage.email.smtp.required'))
      return
    }
    setBusy(true)
    setError(null)
    let createdId: string | null = null
    try {
      const account = await createSmtpImapAccount(token, {
        email: address,
        username: user,
        password,
        imapHost: imapHost.trim(),
        imapPort: Number(imapPort) || 993,
        imapSsl,
        smtpHost: smtpHostValue,
        smtpPort: Number(smtpPort) || (smtpMode === 'ssl' ? 465 : 587),
        smtpSsl: smtpMode === 'ssl',
        smtpStarttls: smtpMode === 'starttls',
      })
      createdId = account.id
      await verifySmtpImapAccount(token, account.id)
      setConnected(true)
      setPassword('')
      toast.success(t('channelsPage.email.smtp.connectedToast'))
      onConnected()
    } catch (e) {
      if (createdId) {
        try {
          await deleteChannelAccount(token, createdId)
        } catch {
          // Best-effort cleanup so a failed verify does not leave a half-connected row.
        }
      }
      const msg = formatApiErrorMessage(e, '')
      const lower = msg.toLowerCase()
      if (lower.includes('reach') || lower.includes('network') || lower.includes('firewall')) {
        setError(t('channelsPage.email.smtp.networkError'))
      } else if (lower.includes('login') || lower.includes('password') || lower.includes('auth')) {
        setError(t('channelsPage.email.smtp.authError'))
      } else {
        setError(msg || t('channelsPage.email.smtp.couldNotConnect'))
      }
    } finally {
      setBusy(false)
    }
  }, [
    token,
    busy,
    email,
    username,
    password,
    imapHost,
    imapPort,
    imapSsl,
    smtpHost,
    smtpPort,
    smtpMode,
    sameHost,
    onConnected,
    t,
  ])

  return (
    <div className="space-y-4">
      <StepRail
        steps={[
          t('channelsPage.email.smtp.step1Title'),
          t('channelsPage.email.smtp.step2Title'),
          t('channelsPage.email.smtp.step3Title'),
        ]}
        active={activeStep}
        done={connected ? [1, 2] : []}
      />

      {!connected ? (
        <>
          <StepPanel number={1} title={t('channelsPage.email.smtp.step1Title')} active={activeStep === 1}>
            <p className="text-[12.5px] leading-relaxed text-text-secondary">
              {t('channelsPage.email.smtp.step1Body')}
            </p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[12.5px] leading-snug text-text-secondary">
              <li>{t('channelsPage.email.smtp.step1ItemImap')}</li>
              <li>{t('channelsPage.email.smtp.step1ItemPassword')}</li>
              <li>{t('channelsPage.email.smtp.step1ItemPorts')}</li>
              <li>{t('channelsPage.email.smtp.step1ItemFirewall')}</li>
            </ol>
          </StepPanel>

          <StepPanel number={2} title={t('channelsPage.email.smtp.step2Title')} active={activeStep === 2}>
            <p className="mb-3 text-[12.5px] leading-relaxed text-text-secondary">
              {t('channelsPage.email.smtp.step2Body')}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('channelsPage.email.smtp.email')} hint={t('channelsPage.email.smtp.emailHint')} required>
                <input
                  value={email}
                  onChange={(e) => {
                    const next = e.target.value
                    setEmail(next)
                    if (!username || username === email) setUsername(next)
                  }}
                  type="email"
                  autoComplete="off"
                  className={fieldClass}
                />
              </Field>
              <Field
                label={t('channelsPage.email.smtp.username')}
                hint={t('channelsPage.email.smtp.usernameHint')}
                required
              >
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  className={cn(fieldClass, 'font-mono')}
                />
              </Field>
              <Field
                label={t('channelsPage.email.smtp.password')}
                hint={t('channelsPage.email.smtp.passwordHint')}
                required
              >
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="off"
                  className={cn(fieldClass, 'font-mono')}
                />
              </Field>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={sameHost}
                    onChange={(e) => setSameHost(e.target.checked)}
                  />
                  {t('channelsPage.email.smtp.sameHost')}
                </label>
              </div>
              <Field
                label={t('channelsPage.email.smtp.imapHost')}
                hint={t('channelsPage.email.smtp.imapHostHint')}
                required
              >
                <input
                  value={imapHost}
                  onChange={(e) => {
                    setImapHost(e.target.value)
                    if (sameHost) setSmtpHost(e.target.value)
                  }}
                  placeholder="imap.example.com"
                  className={cn(fieldClass, 'font-mono')}
                  autoComplete="off"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('channelsPage.email.smtp.imapPort')} hint={t('channelsPage.email.smtp.portHint993')}>
                  <input
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                    className={cn(fieldClass, 'font-mono')}
                    inputMode="numeric"
                  />
                </Field>
                <Field label={t('channelsPage.email.smtp.imapSsl')} hint={t('channelsPage.email.smtp.imapSslHint')}>
                  <label className="flex h-[34px] items-center gap-2 text-[12.5px] text-text-secondary">
                    <input
                      type="checkbox"
                      checked={imapSsl}
                      onChange={(e) => setImapSsl(e.target.checked)}
                    />
                    SSL
                  </label>
                </Field>
              </div>
              {!sameHost ? (
                <Field
                  label={t('channelsPage.email.smtp.smtpHost')}
                  hint={t('channelsPage.email.smtp.smtpHostHint')}
                  required
                >
                  <input
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.example.com"
                    className={cn(fieldClass, 'font-mono')}
                    autoComplete="off"
                  />
                </Field>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('channelsPage.email.smtp.smtpPort')} hint={t('channelsPage.email.smtp.portHint587')}>
                  <input
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    className={cn(fieldClass, 'font-mono')}
                    inputMode="numeric"
                  />
                </Field>
                <Field label={t('channelsPage.email.smtp.smtpSecurity')} hint={t('channelsPage.email.smtp.smtpSecurityHint')}>
                  <select
                    value={smtpMode}
                    onChange={(e) => {
                      const mode = e.target.value === 'ssl' ? 'ssl' : 'starttls'
                      setSmtpMode(mode)
                      if (mode === 'ssl' && (smtpPort === '587' || !smtpPort)) setSmtpPort('465')
                      if (mode === 'starttls' && (smtpPort === '465' || !smtpPort)) setSmtpPort('587')
                    }}
                    className={fieldClass}
                  >
                    <option value="starttls">STARTTLS</option>
                    <option value="ssl">SSL</option>
                  </select>
                </Field>
              </div>
            </div>
            {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
            <div className="mt-3 flex justify-end">
              <Button size="sm" disabled={busy} onClick={() => void connect()}>
                {busy ? t('channelsPage.email.smtp.connecting') : t('channelsPage.email.smtp.connect')}
              </Button>
            </div>
          </StepPanel>
        </>
      ) : (
        <StepPanel number={3} title={t('channelsPage.email.smtp.step3Title')} active>
          <p className="text-[12.5px] leading-relaxed text-text-secondary">
            {t('channelsPage.email.smtp.step3Body')}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/40 pt-3">
            <Link to={inboxPath('open')} className="text-[12.5px] font-medium text-accent hover:underline">
              {t('channelsPage.email.smtp.openCommunication')}
            </Link>
            <Link
              to="/settings/communication"
              className="text-[12.5px] font-medium text-accent hover:underline"
            >
              {t('channelsPage.email.smtp.openChannels')}
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
    <ol className="flex items-stretch gap-1.5" aria-label="SMTP IMAP setup">
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
