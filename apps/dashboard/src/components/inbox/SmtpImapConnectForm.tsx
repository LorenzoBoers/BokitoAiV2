import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronDown, Info } from 'lucide-react'
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
import ConnectStepRail from './ConnectStepRail'

type SmtpMode = 'starttls' | 'ssl'
type PresetId = 'custom' | 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'zoho'

type ProviderPreset = {
  id: PresetId
  imapHost: string
  imapPort: string
  imapSsl: boolean
  smtpHost: string
  smtpPort: string
  smtpMode: SmtpMode
  sameHost: boolean
}

const PRESETS: ProviderPreset[] = [
  {
    id: 'custom',
    imapHost: '',
    imapPort: '993',
    imapSsl: true,
    smtpHost: '',
    smtpPort: '587',
    smtpMode: 'starttls',
    sameHost: false,
  },
  {
    id: 'gmail',
    imapHost: 'imap.gmail.com',
    imapPort: '993',
    imapSsl: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: '587',
    smtpMode: 'starttls',
    sameHost: false,
  },
  {
    id: 'outlook',
    imapHost: 'outlook.office365.com',
    imapPort: '993',
    imapSsl: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: '587',
    smtpMode: 'starttls',
    sameHost: false,
  },
  {
    id: 'yahoo',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: '993',
    imapSsl: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: '465',
    smtpMode: 'ssl',
    sameHost: false,
  },
  {
    id: 'icloud',
    imapHost: 'imap.mail.me.com',
    imapPort: '993',
    imapSsl: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: '587',
    smtpMode: 'starttls',
    sameHost: false,
  },
  {
    id: 'zoho',
    imapHost: 'imap.zoho.com',
    imapPort: '993',
    imapSsl: true,
    smtpHost: 'smtp.zoho.com',
    smtpPort: '587',
    smtpMode: 'starttls',
    sameHost: false,
  },
]

function presetFromEmailDomain(email: string): PresetId | null {
  const domain = email.trim().split('@')[1]?.toLowerCase() ?? ''
  if (!domain) return null
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail'
  if (
    domain === 'outlook.com' ||
    domain === 'hotmail.com' ||
    domain === 'live.com' ||
    domain === 'msn.com' ||
    domain.endsWith('.onmicrosoft.com')
  ) {
    return 'outlook'
  }
  if (domain === 'yahoo.com' || domain.startsWith('yahoo.')) return 'yahoo'
  if (domain === 'icloud.com' || domain === 'me.com' || domain === 'mac.com') return 'icloud'
  if (domain === 'zoho.com' || domain.endsWith('.zoho.com')) return 'zoho'
  return null
}

/**
 * Connect any mailbox via IMAP (receive) + SMTP (send).
 * Account details first, then provider presets and clear Incoming / Outgoing blocks.
 */
export default function SmtpImapConnectForm({ onConnected }: { onConnected: () => void }) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showUsername, setShowUsername] = useState(false)
  const [presetId, setPresetId] = useState<PresetId>('custom')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [imapSsl, setImapSsl] = useState(true)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpMode, setSmtpMode] = useState<SmtpMode>('starttls')
  const [sameHost, setSameHost] = useState(false)
  const [tipsOpen, setTipsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  const activeStep: number = connected ? 3 : 2
  const effectiveUsername = (username.trim() || email.trim()).trim()

  const applyPreset = useCallback((id: PresetId) => {
    const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0]
    setPresetId(preset.id)
    setImapHost(preset.imapHost)
    setImapPort(preset.imapPort)
    setImapSsl(preset.imapSsl)
    setSmtpHost(preset.smtpHost)
    setSmtpPort(preset.smtpPort)
    setSmtpMode(preset.smtpMode)
    setSameHost(preset.sameHost)
  }, [])

  const markCustomIfEdited = useCallback(() => {
    if (presetId !== 'custom') setPresetId('custom')
  }, [presetId])

  const onEmailBlur = useCallback(() => {
    const suggested = presetFromEmailDomain(email)
    if (!suggested) return
    if (presetId === 'custom' && !imapHost.trim() && !smtpHost.trim()) {
      applyPreset(suggested)
    }
  }, [email, presetId, imapHost, smtpHost, applyPreset])

  const canSubmit = useMemo(() => {
    if (!email.trim() || !password || !imapHost.trim()) return false
    if (!sameHost && !smtpHost.trim()) return false
    return true
  }, [email, password, imapHost, smtpHost, sameHost])

  const connect = useCallback(async () => {
    if (!token || busy) return
    const address = email.trim()
    const user = effectiveUsername
    if (!address || !user || !password || !imapHost.trim()) {
      setError(t('channelsPage.email.smtp.required'))
      return
    }
    const smtpHostValue = sameHost ? imapHost.trim() : smtpHost.trim()
    if (!smtpHostValue) {
      setError(t('channelsPage.email.smtp.requiredSmtpHost'))
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
    effectiveUsername,
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
      <ConnectStepRail
        steps={[
          t('channelsPage.email.smtp.step1Title'),
          t('channelsPage.email.smtp.step2Title'),
          t('channelsPage.email.smtp.step3Title'),
        ]}
        active={activeStep}
        done={connected ? [1, 2] : [1]}
        ariaLabel="SMTP IMAP setup"
      />

      {!connected ? (
        <>
          <section className="space-y-3">
            <SectionHeading title={t('channelsPage.email.smtp.accountTitle')} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('channelsPage.email.smtp.email')}
                hint={t('channelsPage.email.smtp.emailHint')}
                required
                className="sm:col-span-2"
              >
                <input
                  value={email}
                  onChange={(e) => {
                    const next = e.target.value
                    setEmail(next)
                    if (!showUsername || !username || username === email) setUsername(next)
                  }}
                  onBlur={onEmailBlur}
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="off"
                  className={fieldClass}
                />
              </Field>
              <Field
                label={t('channelsPage.email.smtp.password')}
                hint={t('channelsPage.email.smtp.passwordHint')}
                required
                className="sm:col-span-2"
              >
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="••••••••"
                  autoComplete="off"
                  className={cn(fieldClass, 'font-mono')}
                />
              </Field>
            </div>
            {!showUsername ? (
              <button
                type="button"
                onClick={() => {
                  setShowUsername(true)
                  if (!username) setUsername(email)
                }}
                className="text-[12px] font-medium text-accent hover:underline"
              >
                {t('channelsPage.email.smtp.showUsername')}
              </button>
            ) : (
              <Field
                label={t('channelsPage.email.smtp.username')}
                hint={t('channelsPage.email.smtp.usernameHint')}
              >
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={email || 'you@company.com'}
                  autoComplete="off"
                  className={cn(fieldClass, 'font-mono')}
                />
              </Field>
            )}
          </section>

          <section className="space-y-2.5">
            <SectionHeading
              title={t('channelsPage.email.smtp.providerTitle')}
              subtitle={t('channelsPage.email.smtp.providerHint')}
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('channelsPage.email.smtp.providerTitle')}>
              {PRESETS.map((preset) => {
                const selected = presetId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors',
                      selected
                        ? 'border-accent/50 bg-accent/15 text-text-heading'
                        : 'border-border/50 bg-bg-elevated/40 text-text-secondary hover:border-border hover:bg-bg-hover',
                    )}
                  >
                    {t(`channelsPage.email.smtp.presets.${preset.id}`)}
                  </button>
                )
              })}
            </div>
          </section>

          <div className="space-y-3">
            <ServerCard title={t('channelsPage.email.smtp.incomingTitle')}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_8.5rem]">
                <Field
                  label={t('channelsPage.email.smtp.imapHost')}
                  hint={t('channelsPage.email.smtp.imapHostHint')}
                  required
                >
                  <input
                    value={imapHost}
                    onChange={(e) => {
                      markCustomIfEdited()
                      setImapHost(e.target.value)
                      if (sameHost) setSmtpHost(e.target.value)
                    }}
                    placeholder="imap.example.com"
                    className={cn(fieldClass, 'font-mono')}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('channelsPage.email.smtp.imapPort')} hint={t('channelsPage.email.smtp.portHint993')}>
                  <input
                    value={imapPort}
                    onChange={(e) => {
                      markCustomIfEdited()
                      setImapPort(e.target.value)
                    }}
                    className={cn(fieldClass, 'font-mono')}
                    inputMode="numeric"
                  />
                </Field>
                <Field
                  label={t('channelsPage.email.smtp.imapSsl')}
                  hint={t('channelsPage.email.smtp.imapSslHint')}
                >
                  <select
                    value={imapSsl ? 'ssl' : 'none'}
                    onChange={(e) => {
                      markCustomIfEdited()
                      const nextSsl = e.target.value === 'ssl'
                      setImapSsl(nextSsl)
                      if (nextSsl && (imapPort === '143' || !imapPort)) setImapPort('993')
                      if (!nextSsl && (imapPort === '993' || !imapPort)) setImapPort('143')
                    }}
                    className={fieldClass}
                  >
                    <option value="ssl">SSL</option>
                    <option value="none">{t('channelsPage.email.smtp.securityNone')}</option>
                  </select>
                </Field>
              </div>
            </ServerCard>

            <label className="flex items-center gap-2 rounded-lg border border-border/45 bg-bg-elevated/20 px-3 py-2.5 text-[12.5px] text-text-secondary">
              <input
                type="checkbox"
                checked={sameHost}
                onChange={(e) => {
                  const next = e.target.checked
                  setSameHost(next)
                  markCustomIfEdited()
                  if (next) setSmtpHost(imapHost)
                }}
              />
              <span>{t('channelsPage.email.smtp.sameHost')}</span>
            </label>

            <ServerCard title={t('channelsPage.email.smtp.outgoingTitle')}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_8.5rem]">
                <Field
                  label={t('channelsPage.email.smtp.smtpHost')}
                  hint={
                    sameHost
                      ? t('channelsPage.email.smtp.sameHostActive', {
                          host: imapHost.trim() || 'imap.example.com',
                        })
                      : t('channelsPage.email.smtp.smtpHostHint')
                  }
                  required={!sameHost}
                >
                  <input
                    value={sameHost ? imapHost : smtpHost}
                    onChange={(e) => {
                      if (sameHost) return
                      markCustomIfEdited()
                      setSmtpHost(e.target.value)
                    }}
                    placeholder="smtp.example.com"
                    className={cn(fieldClass, 'font-mono', sameHost && 'opacity-70')}
                    autoComplete="off"
                    readOnly={sameHost}
                    disabled={sameHost}
                  />
                </Field>
                <Field label={t('channelsPage.email.smtp.smtpPort')} hint={t('channelsPage.email.smtp.portHint587')}>
                  <input
                    value={smtpPort}
                    onChange={(e) => {
                      markCustomIfEdited()
                      setSmtpPort(e.target.value)
                    }}
                    className={cn(fieldClass, 'font-mono')}
                    inputMode="numeric"
                  />
                </Field>
                <Field
                  label={t('channelsPage.email.smtp.smtpSecurity')}
                  hint={t('channelsPage.email.smtp.smtpSecurityHint')}
                >
                  <select
                    value={smtpMode}
                    onChange={(e) => {
                      markCustomIfEdited()
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
            </ServerCard>
          </div>

          <div className="rounded-lg border border-border/50 bg-bg-elevated/25">
            <button
              type="button"
              onClick={() => setTipsOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] font-medium text-text-secondary hover:text-text-heading"
              aria-expanded={tipsOpen}
            >
              <Info size={14} className="shrink-0 text-accent" aria-hidden />
              <span className="flex-1">{t('channelsPage.email.smtp.tipsTitle')}</span>
              <ChevronDown
                size={14}
                className={cn('shrink-0 transition-transform', tipsOpen && 'rotate-180')}
                aria-hidden
              />
            </button>
            {tipsOpen ? (
              <ol className="space-y-1.5 border-t border-border/40 px-3 py-2.5 pl-8 text-[12px] leading-snug text-text-muted list-decimal">
                <li>{t('channelsPage.email.smtp.step1ItemImap')}</li>
                <li>{t('channelsPage.email.smtp.step1ItemPassword')}</li>
                <li>{t('channelsPage.email.smtp.step1ItemPorts')}</li>
                <li>{t('channelsPage.email.smtp.step1ItemFirewall')}</li>
              </ol>
            ) : null}
          </div>

          {error ? <p className="text-xs text-status-error">{error}</p> : null}

          <div className="flex justify-end">
            <Button size="sm" disabled={busy || !canSubmit} onClick={() => void connect()}>
              {busy ? t('channelsPage.email.smtp.connecting') : t('channelsPage.email.smtp.connect')}
            </Button>
          </div>
        </>
      ) : (
        <section className="rounded-xl border border-border/60 bg-bg-elevated/30 p-3.5">
          <header className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
              3
            </span>
            <h3 className="text-[13px] font-semibold text-text-heading">
              {t('channelsPage.email.smtp.step3Title')}
            </h3>
          </header>
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
        </section>
      )}
    </div>
  )
}

const fieldClass =
  'w-full rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60'

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-0.5">
      <h3 className="text-[13px] font-semibold text-text-heading">{title}</h3>
      {subtitle ? <p className="text-[12px] text-text-muted">{subtitle}</p> : null}
    </div>
  )
}

function ServerCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border/55 bg-bg-elevated/25 p-3.5">
      <h4 className="text-[12.5px] font-semibold tracking-wide text-text-heading">{title}</h4>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string
  hint: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex flex-col gap-1 text-xs text-text-muted', className)}>
      <span className="flex items-baseline gap-1 text-text-secondary">
        <span className="font-medium text-text-heading">{label}</span>
        {required ? <span className="text-status-error">*</span> : null}
      </span>
      {children}
      <span className="text-[11px] leading-snug text-text-muted">{hint}</span>
    </label>
  )
}
