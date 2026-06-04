import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { AtSign, Check, ClipboardCopy, Mail, Palette, Plus, Send, Signature, Trash2, X } from 'lucide-react'
import { OauthRedirectAlert } from '../components/email/OauthRedirectAlert'
import ProviderLogo from '../components/email/ProviderLogo'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Textarea } from '../components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useAuth } from '../context/AuthContext'
import { integrationsRoutes } from '../api/routes/integrations.routes'
import { buildEmailOAuthReturnUrl, ensureOutlookAuthorizeUrlHasClientId } from '../lib/email-api'
import { xanoDeleteIntegrations, xanoGetIntegrations } from '../lib/xano'
import {
  PROVIDER_LABEL,
  describeOAuthCallbackSummary,
  logOAuthRedirectDebugInDev,
  parseOAuthCallback,
  providerFriendlyName,
  toProvider,
  type ConnectionStatus,
  type OAuthProvider,
  type Provider,
} from '../lib/email-oauth'

type EmailConnection = {
  id: number
  provider: OAuthProvider
  mailboxEmail: string
  displayName: string
  status: ConnectionStatus
  lastSyncAt: string | null
  lastError: string | null
  isEnabled: boolean
  isPrimary: boolean
}

type LocalSmtpAccount = {
  id: string
  provider: 'smtp_imap'
  label: string
  fromEmail: string
  authMethod: 'SMTP/IMAP'
  status: 'Concept'
}

type OAuthStartResponse = { authorize_url?: string; authorizeUrl?: string }

const providerOptions: Array<{ id: Provider; description: string }> = [
  { id: 'outlook', description: 'Microsoft 365 en Outlook.com via OAuth.' },
  { id: 'gmail', description: 'Google Workspace en Gmail via OAuth.' },
  { id: 'smtp_imap', description: 'Eigen mailserver via SMTP en IMAP.' },
]

function toString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeStatus(value: unknown): ConnectionStatus {
  const status = toString(value).toLowerCase()
  if (status === 'active' || status === 'error' || status === 'revoked') return status
  return 'active'
}

function normalizeConnections(payload: unknown): EmailConnection[] {
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : []

  return source
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      const pk = raw.id ?? raw.connection_pk
      const id = typeof pk === 'number' ? pk : Number(pk)
      if (!Number.isFinite(id)) return null
      const provider = toProvider(toString(raw.provider).toLowerCase())
      if (!provider) return null
      const mailboxEmail = toString(raw.mailbox_email ?? raw.mailboxEmail)
      const displayName = toString(raw.display_name ?? raw.displayName, mailboxEmail)
      const rawEnabled = raw.is_enabled ?? raw.isEnabled
      const isEnabled = rawEnabled === false ? false : true
      const rawPrimary = raw.is_primary ?? raw.isPrimary
      const isPrimary = rawPrimary === true
      return {
        id,
        provider,
        mailboxEmail,
        displayName,
        status: normalizeStatus(raw.status),
        lastSyncAt: toString(raw.last_sync_at ?? raw.lastSyncAt) || null,
        lastError: toString(raw.last_error ?? raw.lastError) || null,
        isEnabled,
        isPrimary,
      } satisfies EmailConnection
    })
    .filter((row): row is EmailConnection => row !== null)
}

function statusLabel(status: ConnectionStatus): string {
  if (status === 'active') return 'Verbonden'
  if (status === 'error') return 'Fout'
  return 'Verwijderd'
}

function statusBadgeVariant(status: ConnectionStatus): 'success' | 'error' | 'neutral' {
  if (status === 'active') return 'success'
  if (status === 'error') return 'error'
  return 'neutral'
}

type EmailSettingsBanner =
  | { mode: 'simple'; variant: 'success' | 'error'; text: string }
  | {
      mode: 'oauth_error'
      title: string
      summary: string
      code: string
      detail: string | null
    }

export default function EmailSettings() {
  const { token, user, isLoading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const [modalProvider, setModalProvider] = useState<'outlook' | 'gmail' | 'smtp_imap'>('outlook')
  const [label, setLabel] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [oauthConnections, setOauthConnections] = useState<EmailConnection[]>([])
  const [localSmtpAccounts, setLocalSmtpAccounts] = useState<LocalSmtpAccount[]>([])
  const [formError, setFormError] = useState('')
  const [banner, setBanner] = useState<EmailSettingsBanner | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<Record<OAuthProvider, boolean>>({
    outlook: false,
    gmail: false,
  })
  const [ignoredInput, setIgnoredInput] = useState('')
  const [ignoredAddresses, setIgnoredAddresses] = useState<string[]>([])
  const [brandSenderName, setBrandSenderName] = useState('Bokito Support')
  const [brandReplyTo, setBrandReplyTo] = useState('')
  const [brandColor, setBrandColor] = useState('#635bff')
  const DEFAULT_SIGNATURE = `<table cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:13px;color:#374151;border-collapse:collapse;">
  <tr>
    <td style="padding-right:14px;vertical-align:top;">
      <img src="{{agent_avatar_url}}" width="48" height="48" style="border-radius:50%;display:block;" alt="{{agent_name}}" />
    </td>
    <td style="vertical-align:top;border-left:2px solid #4652f2;padding-left:14px;">
      <p style="margin:0;font-weight:700;font-size:14px;color:#111827;">{{agent_name}}</p>
      <p style="margin:2px 0 6px;font-size:12px;color:#6b7280;">{{agent_title}} &middot; {{company_name}}</p>
      <p style="margin:0;font-size:12px;color:#6b7280;">
        <a href="mailto:{{agent_email}}" style="color:#4652f2;text-decoration:none;">{{agent_email}}</a>
        &nbsp;&bull;&nbsp;{{agent_phone}}
      </p>
      <p style="margin:6px 0 0;">
        <a href="{{company_website}}" style="font-size:11px;color:#9ca3af;text-decoration:none;">{{company_website}}</a>
      </p>
    </td>
  </tr>
</table>`

  const PLACEHOLDERS = [
    { key: '{{agent_name}}',       label: 'Agent naam',            example: 'Lorenzo Boers' },
    { key: '{{agent_title}}',      label: 'Agent functietitel',    example: 'Support Manager' },
    { key: '{{agent_email}}',      label: 'Agent e-mailadres',     example: 'lorenzo@bokito.ai' },
    { key: '{{agent_phone}}',      label: 'Agent telefoonnummer',  example: '+31 6 12345678' },
    { key: '{{agent_avatar_url}}', label: 'Agent profielfoto URL', example: 'https://cdn.bokito.ai/avatar.jpg' },
    { key: '{{company_name}}',     label: 'Bedrijfsnaam',          example: 'Bokito AI' },
    { key: '{{company_website}}',  label: 'Bedrijfswebsite',       example: 'https://bokito.ai' },
    { key: '{{company_logo_url}}', label: 'Bedrijfslogo URL',      example: 'https://cdn.bokito.ai/logo.png' },
    { key: '{{company_phone}}',    label: 'Bedrijfstelefoon',      example: '+31 20 123 4567' },
  ]

  const PREVIEW_VALUES: Record<string, string> = {
    '{{agent_name}}':       'Lorenzo Boers',
    '{{agent_title}}':      'Support Manager',
    '{{agent_email}}':      'lorenzo@bokito.ai',
    '{{agent_phone}}':      '+31 6 12345678',
    '{{agent_avatar_url}}': 'https://ui-avatars.com/api/?name=Lorenzo+Boers&background=4652f2&color=fff&size=96',
    '{{company_name}}':     'Bokito AI',
    '{{company_website}}':  'https://bokito.ai',
    '{{company_logo_url}}': '/bokito-logo.svg',
    '{{company_phone}}':    '+31 20 123 4567',
  }

  const [signatureHtml, setSignatureHtml] = useState(DEFAULT_SIGNATURE)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const signaturePreview = useMemo(() => {
    let html = signatureHtml
    for (const [key, value] of Object.entries(PREVIEW_VALUES)) {
      html = html.split(key).join(value)
    }
    return html
  }, [signatureHtml])

  const tenantLine = useMemo(() => {
    const name = user?.tenant?.name?.trim()
    if (!name || name === 'Onbekend') return null
    return `Koppelingen gelden voor workspace: ${name}`
  }, [user?.tenant?.name])

  const fetchConnections = useCallback(async () => {
    if (!token) return
    if (authLoading) return
    if (!user?.organisationId) {
      setOauthConnections([])
      setListError(null)
      return
    }
    setListLoading(true)
    setListError(null)
    try {
      const payload = await xanoGetIntegrations<unknown>(integrationsRoutes.email.connections.list, token)
      setOauthConnections(normalizeConnections(payload))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kon e-mailkoppelingen niet laden.'
      setListError(message)
      setOauthConnections([])
    } finally {
      setListLoading(false)
    }
  }, [token, user?.organisationId, authLoading])

  useEffect(() => {
    void fetchConnections()
  }, [fetchConnections])

  useEffect(() => {
    const callback = parseOAuthCallback(searchParams)
    if (callback.handled) logOAuthRedirectDebugInDev(searchParams, callback)
    if (callback.handled && callback.provider && callback.status === 'connected') {
      setBanner({
        mode: 'simple',
        variant: 'success',
        text: `${providerFriendlyName(callback.provider)} is succesvol gekoppeld.`,
      })
      void fetchConnections()
    } else if (callback.handled && callback.error) {
      setBanner({
        mode: 'oauth_error',
        title: `${providerFriendlyName(callback.provider ?? 'outlook')} koppelen mislukt`,
        summary: describeOAuthCallbackSummary(callback),
        code: callback.error,
        detail: callback.detail,
      })
    }

    if (callback.handled) {
      const next = new URLSearchParams(searchParams)
      next.delete('oauth_provider')
      next.delete('oauth_status')
      next.delete('oauth_error')
      next.delete('outlook')
      next.delete('outlook_error')
      next.delete('aad_detail')
      next.delete('oauth_detail')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, fetchConnections])

  function resetForm() {
    setModalProvider('outlook')
    setLabel('')
    setFromEmail('')
    setFromName('')
    setSmtpHost('')
    setSmtpPort('587')
    setImapHost('')
    setImapPort('993')
    setUsername('')
    setPassword('')
    setFormError('')
  }

  async function handleConnectOAuth(provider: OAuthProvider) {
    if (!token) return
    setBanner(null)
    setOauthLoading((prev) => ({ ...prev, [provider]: true }))

    try {
      const returnUrl = buildEmailOAuthReturnUrl()
      const encodedReturnUrl = encodeURIComponent(returnUrl)
      const genericPath = integrationsRoutes.email.oauth.start(provider, encodedReturnUrl)
      let data: OAuthStartResponse
      try {
        data = await xanoGetIntegrations<OAuthStartResponse>(genericPath, token)
      } catch (error) {
        if (provider === 'outlook') {
          data = await xanoGetIntegrations<OAuthStartResponse>(integrationsRoutes.email.oauth.outlookStart(encodedReturnUrl), token)
        } else if (provider === 'gmail') {
          data = await xanoGetIntegrations<OAuthStartResponse>(integrationsRoutes.email.oauth.googleStart(encodedReturnUrl), token)
        } else {
          throw error
        }
      }

      const url = data.authorize_url ?? data.authorizeUrl
      if (!url) throw new Error('Geen authorize-URL ontvangen van de server.')
      if (provider === 'outlook') ensureOutlookAuthorizeUrlHasClientId(url)
      window.location.assign(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : `${PROVIDER_LABEL[provider]} OAuth start mislukt.`
      setBanner({ mode: 'simple', variant: 'error', text: message })
      setOauthLoading((prev) => ({ ...prev, [provider]: false }))
    }
  }

  async function handleDeleteOAuth(id: number) {
    if (!token) return
    try {
      await xanoDeleteIntegrations(integrationsRoutes.email.connections.byId(id), token)
      setOauthConnections((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verwijderen mislukt.'
      setBanner({ mode: 'simple', variant: 'error', text: message })
    }
  }

  function handleAddSmtpAccount() {
    setFormError('')
    if (!label.trim() || !fromEmail.trim() || !fromName.trim()) {
      setFormError('Vul accountnaam, afzender e-mail en afzendernaam in.')
      return
    }
    if (!smtpHost.trim() || !imapHost.trim() || !username.trim() || !password.trim()) {
      setFormError('Vul voor SMTP / IMAP alle server- en loginvelden in.')
      return
    }

    const next: LocalSmtpAccount = {
      id: `local-${Date.now()}`,
      provider: 'smtp_imap',
      label: label.trim(),
      fromEmail: fromEmail.trim(),
      authMethod: 'SMTP/IMAP',
      status: 'Concept',
    }

    setLocalSmtpAccounts((prev) => [next, ...prev])
    resetForm()
    setOpen(false)
  }

  async function handleModalSubmit() {
    if (modalProvider === 'smtp_imap') {
      handleAddSmtpAccount()
      return
    }
    await handleConnectOAuth(modalProvider)
  }

  const hasRows = oauthConnections.length > 0 || localSmtpAccounts.length > 0
  const isSmtp = modalProvider === 'smtp_imap'
  const modalOAuthLoading = modalProvider !== 'smtp_imap' ? oauthLoading[modalProvider] : false

  function handleAddIgnoredAddress() {
    const value = ignoredInput.trim().toLowerCase()
    if (!value || ignoredAddresses.includes(value)) return
    setIgnoredAddresses((prev) => [value, ...prev])
    setIgnoredInput('')
  }

  function saveDraftUx(section: 'branding' | 'signatures') {
    setBanner({
      mode: 'simple',
      variant: 'success',
      text: section === 'branding' ? 'Branding instellingen opgeslagen (UX draft).' : 'Signature instellingen opgeslagen (UX draft).',
    })
  }

  return (
    <div className="h-full py-3">
      <div className="mx-auto flex h-full min-h-0 max-w-5xl flex-col">
        <div className="border-b border-border/50 pb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-heading">
            <Mail size={16} className="text-accent" />
            Email
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Configure sending domains, addresses, OAuth accounts, branding, and signatures.
          </p>
          {tenantLine ? <p className="mt-1 text-2xs text-text-muted">{tenantLine}</p> : null}
        </div>

        {banner?.mode === 'oauth_error' ? (
          <div className="mt-2">
            <OauthRedirectAlert
              variant="error"
              title={banner.title}
              errorCode={banner.code}
              technicalDetail={banner.detail}
              onDismiss={() => setBanner(null)}
            >
              {banner.summary}
            </OauthRedirectAlert>
          </div>
        ) : banner?.mode === 'simple' ? (
          <div
            className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
              banner.variant === 'success'
                ? 'border-status-success/40 bg-status-success/10 text-status-success'
                : 'border-status-error/40 bg-status-error/10 text-status-error'
            }`}
          >
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 sm:items-center">
              <span className="min-w-0 flex-1 leading-snug">{banner.text}</span>
              <button
                type="button"
                className="ml-auto shrink-0 underline opacity-90 hover:opacity-100 sm:ml-0"
                onClick={() => setBanner(null)}
              >
                Sluiten
              </button>
            </div>
          </div>
        ) : null}

        {listError ? <p className="text-xs text-status-error mt-2">{listError}</p> : null}
        {listLoading ? <p className="text-xs text-text-muted mt-2">Laden…</p> : null}

        <Tabs defaultValue="sending" className="mt-4 min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="sending">
              <Send size={14} className="mr-1.5" />
              Sending
            </TabsTrigger>
            <TabsTrigger value="ignored">
              <AtSign size={14} className="mr-1.5" />
              Ignored addresses
            </TabsTrigger>
            <TabsTrigger value="branding">
              <Palette size={14} className="mr-1.5" />
              Branding
            </TabsTrigger>
            <TabsTrigger value="signatures">
              <Signature size={14} className="mr-1.5" />
              Signatures
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sending" className="min-h-0 space-y-5 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-heading">Connected providers</p>
                <p className="text-sm text-text-secondary">Koppel Outlook en Gmail via OAuth of voeg SMTP / IMAP toe.</p>
              </div>
              <Dialog.Root open={open} onOpenChange={setOpen}>
                <Dialog.Trigger asChild>
                  <Button size="sm">
                    <Plus size={13} />
                    Add provider
                  </Button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" />
                  <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[760px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border/70 bg-bg-surface p-4 shadow-[0_20px_60px_rgba(5,8,18,0.4)]">
                    <div className="mb-3 flex items-center justify-between">
                      <Dialog.Title className="text-sm font-semibold text-text-heading">Account koppelen</Dialog.Title>
                      <Dialog.Close asChild>
                        <button type="button" className="rounded p-1 text-text-muted hover:text-text-primary">
                          <X size={14} />
                        </button>
                      </Dialog.Close>
                    </div>

                    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {providerOptions.map((providerOption) => (
                        <button
                          key={providerOption.id}
                          type="button"
                          onClick={() => setModalProvider(providerOption.id)}
                          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                            modalProvider === providerOption.id ? 'border-accent bg-accent/10' : 'border-border/60 hover:border-border'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <ProviderLogo provider={providerOption.id} className="mt-0.5 h-6 w-6 object-contain" />
                            <div>
                              <p className="text-xs font-medium text-text-heading">{PROVIDER_LABEL[providerOption.id]}</p>
                              <p className="mt-0.5 text-2xs text-text-muted">{providerOption.description}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>

                    {isSmtp ? (
                      <>
                        <p className="mb-3 text-2xs text-text-muted">
                          Deze SMTP/IMAP gegevens worden alleen in deze browsersessie bewaard tot er backend-opslag is.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-[11px] text-text-muted">Accountnaam</label>
                            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Support inbox" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-text-muted">Afzender e-mail</label>
                            <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="support@bedrijf.nl" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-text-muted">Afzendernaam</label>
                            <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Bokito Support" />
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-[11px] text-text-muted">SMTP host</label>
                            <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.voorbeeld.nl" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-text-muted">SMTP poort</label>
                            <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-text-muted">IMAP host</label>
                            <Input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.voorbeeld.nl" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-text-muted">IMAP poort</label>
                            <Input value={imapPort} onChange={(e) => setImapPort(e.target.value)} placeholder="993" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-text-muted">Gebruikersnaam</label>
                            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mailbox-user" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-text-muted">Wachtwoord</label>
                            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-lg border border-border/60 bg-bg-input/70 px-3 py-2 text-xs text-text-secondary">
                        Je gaat {PROVIDER_LABEL[modalProvider]} koppelen via OAuth. Na klikken word je doorgestuurd naar de provider login/consent.
                      </div>
                    )}

                    {formError ? <p className="mt-3 text-xs text-status-error">{formError}</p> : null}

                    <div className="mt-4 flex items-center justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={resetForm} disabled={modalOAuthLoading}>
                        Reset
                      </Button>
                      <Button size="sm" onClick={() => void handleModalSubmit()} disabled={modalOAuthLoading || !token}>
                        <Plus size={13} />
                        {isSmtp ? 'Toevoegen' : modalOAuthLoading ? 'Bezig…' : `${PROVIDER_LABEL[modalProvider]} koppelen`}
                      </Button>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Authenticatie</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oauthConnections.map((connection) => (
                  <TableRow key={`oauth-${connection.id}`}>
                    <TableCell>
                      <div className="font-medium">{connection.displayName}</div>
                      <div className="text-xs text-text-muted">{connection.mailboxEmail}</div>
                      {connection.lastSyncAt ? (
                        <div className="mt-0.5 text-2xs text-text-muted">Laatste sync: {new Date(connection.lastSyncAt).toLocaleString()}</div>
                      ) : null}
                      {connection.status === 'error' && connection.lastError ? (
                        <div className="mt-0.5 text-2xs text-status-error">{connection.lastError}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="inline-flex items-center gap-2">
                        <ProviderLogo provider={connection.provider} className="h-4 w-4 object-contain" />
                        <span>{PROVIDER_LABEL[connection.provider]}</span>
                      </div>
                    </TableCell>
                    <TableCell>OAuth</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(connection.status)}>{statusLabel(connection.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => void handleDeleteOAuth(connection.id)}>
                        <Trash2 size={13} />
                        Ontkoppelen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}

                {localSmtpAccounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="font-medium">{account.label}</div>
                      <div className="text-xs text-text-muted">{account.fromEmail}</div>
                    </TableCell>
                    <TableCell>
                      <div className="inline-flex items-center gap-2">
                        <ProviderLogo provider={account.provider} className="h-4 w-4 object-contain" />
                        <span>{PROVIDER_LABEL[account.provider]}</span>
                      </div>
                    </TableCell>
                    <TableCell>{account.authMethod}</TableCell>
                    <TableCell>
                      <Badge variant="warning">{account.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setLocalSmtpAccounts((prev) => prev.filter((item) => item.id !== account.id))}>
                        <Trash2 size={13} />
                        Verwijderen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {!hasRows && !listLoading ? (
              <div className="rounded-lg border border-dashed border-border/60 px-4 py-10 text-center">
                <div className="mb-3 flex items-center justify-center gap-3">
                  <ProviderLogo provider="outlook" className="h-7 w-7 object-contain" />
                  <ProviderLogo provider="gmail" className="h-7 w-7 object-contain" />
                  <span className="text-text-muted">+</span>
                  <ProviderLogo provider="smtp_imap" className="h-7 w-7 object-contain" />
                </div>
                <p className="text-sm font-medium text-text-heading">Nog geen e-mailaccounts gekoppeld</p>
                <p className="mt-1 text-xs text-text-secondary">Gebruik hierboven Add provider om te starten.</p>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="ignored" className="space-y-4 pt-2">
            <div>
              <p className="text-sm font-semibold text-text-heading">Ignored addresses</p>
              <p className="text-sm text-text-secondary">Voorkom dat specifieke adressen in je inboxflow terechtkomen.</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={ignoredInput}
                onChange={(event) => setIgnoredInput(event.target.value)}
                placeholder="email@voorbeeld.nl"
              />
              <Button size="sm" onClick={handleAddIgnoredAddress}>
                <Plus size={13} />
                Add
              </Button>
            </div>
            <div className="rounded-lg border border-border/70 bg-bg-input/50 p-3">
              {ignoredAddresses.length === 0 ? (
                <p className="text-sm text-text-muted">Nog geen adressen toegevoegd.</p>
              ) : (
                <div className="space-y-2">
                  {ignoredAddresses.map((address) => (
                    <div key={address} className="flex items-center justify-between rounded-md bg-bg-surface/80 px-3 py-2">
                      <span className="text-sm text-text-primary">{address}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIgnoredAddresses((prev) => prev.filter((value) => value !== address))}
                      >
                        <Trash2 size={13} />
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="branding" className="space-y-4 pt-2">
            <div>
              <p className="text-sm font-semibold text-text-heading">Email branding</p>
              <p className="text-sm text-text-secondary">Stel alvast branding defaults in voor uitgaande e-mails.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] text-text-muted">Default sender name</label>
                <Input value={brandSenderName} onChange={(event) => setBrandSenderName(event.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-text-muted">Reply-to address</label>
                <Input value={brandReplyTo} onChange={(event) => setBrandReplyTo(event.target.value)} placeholder="reply@bedrijf.nl" />
              </div>
            </div>
            <div className="max-w-[260px]">
              <label className="mb-1 block text-[11px] text-text-muted">Accent color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={brandColor}
                  onChange={(event) => setBrandColor(event.target.value)}
                  className="h-10 w-12 cursor-pointer rounded border border-border/70 bg-transparent p-1"
                />
                <Input value={brandColor} onChange={(event) => setBrandColor(event.target.value)} />
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-bg-surface/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">Preview</p>
              <div className="mt-2 rounded-lg border border-border/60 bg-bg-input/70 p-3">
                <p className="text-sm font-medium text-text-heading">{brandSenderName || 'Sender name'}</p>
                <p className="text-xs text-text-secondary">{brandReplyTo || 'reply@example.com'}</p>
                <div className="mt-3 h-2.5 w-24 rounded-full" style={{ backgroundColor: brandColor }} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveDraftUx('branding')}>
                Save branding
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="signatures" className="space-y-5 pt-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-text-heading">Handtekening</p>
                <p className="text-sm text-text-secondary">Stel een standaard HTML-handtekening in voor uitgaande e-mails.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setSignatureHtml(DEFAULT_SIGNATURE)}>
                Standaard template
              </Button>
            </div>

            {/* Editor + preview side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">HTML</label>
                <Textarea
                  value={signatureHtml}
                  onChange={(event) => setSignatureHtml(event.target.value)}
                  className="min-h-[260px] font-mono text-[12px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Voorbeeld (met testdata)</label>
                <div className="min-h-[260px] rounded-lg border border-border/60 bg-white p-5 overflow-auto">
                  {/* eslint-disable-next-line react/no-danger */}
                  <div dangerouslySetInnerHTML={{ __html: signaturePreview }} />
                </div>
              </div>
            </div>

            {/* Placeholder reference */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">Beschikbare placeholders</p>
              <div className="rounded-xl border border-border/55 overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border/55 bg-bg-elevated/40">
                      <th className="px-4 py-2 text-left font-semibold text-text-muted">Placeholder</th>
                      <th className="px-4 py-2 text-left font-semibold text-text-muted">Beschrijving</th>
                      <th className="px-4 py-2 text-left font-semibold text-text-muted">Voorbeeld</th>
                      <th className="px-4 py-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {PLACEHOLDERS.map((ph) => (
                      <tr key={ph.key} className="border-b border-border/40 last:border-0 hover:bg-bg-hover/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <code className="rounded bg-accent/10 px-1.5 py-0.5 text-accent font-mono">{ph.key}</code>
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary">{ph.label}</td>
                        <td className="px-4 py-2.5 text-text-muted font-mono">{ph.example}</td>
                        <td className="px-2 py-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(ph.key)
                              setCopiedKey(ph.key)
                              setTimeout(() => setCopiedKey(null), 1500)
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-accent transition-colors"
                            title="Kopieer"
                          >
                            {copiedKey === ph.key ? <Check size={12} className="text-accent" /> : <ClipboardCopy size={12} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveDraftUx('signatures')}>
                Opslaan
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
