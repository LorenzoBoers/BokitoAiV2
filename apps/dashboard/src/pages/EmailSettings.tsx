import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { Mail, Plus, Trash2, X } from 'lucide-react'
import ProviderLogo from '../components/email/ProviderLogo'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { useAuth } from '../context/AuthContext'
import { xanoDelete, xanoGet } from '../lib/xano'
import {
  PROVIDER_LABEL,
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
      return {
        id,
        provider,
        mailboxEmail,
        displayName,
        status: normalizeStatus(raw.status),
        lastSyncAt: toString(raw.last_sync_at ?? raw.lastSyncAt) || null,
        lastError: toString(raw.last_error ?? raw.lastError) || null,
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
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<Record<OAuthProvider, boolean>>({
    outlook: false,
    gmail: false,
  })

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
      const payload = await xanoGet<unknown>('/email/connections', token)
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
    if (callback.handled && callback.provider && callback.status === 'connected') {
      setBanner({
        type: 'success',
        text: `${providerFriendlyName(callback.provider)} is succesvol gekoppeld.`,
      })
      void fetchConnections()
    } else if (callback.handled && callback.provider && callback.error) {
      setBanner({
        type: 'error',
        text: `${providerFriendlyName(callback.provider)} koppelen mislukt (${callback.error}).`,
      })
    }

    if (callback.handled) {
      const next = new URLSearchParams(searchParams)
      next.delete('oauth_provider')
      next.delete('oauth_status')
      next.delete('oauth_error')
      next.delete('outlook')
      next.delete('outlook_error')
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
      const genericPath = `/email/oauth/start?provider=${provider}`
      let data: OAuthStartResponse
      try {
        data = await xanoGet<OAuthStartResponse>(genericPath, token)
      } catch (error) {
        // Backward-compatible fallback for existing Outlook endpoint.
        if (provider === 'outlook') {
          data = await xanoGet<OAuthStartResponse>('/email/outlook/oauth/start', token)
        } else {
          throw error
        }
      }

      const url = data.authorize_url ?? data.authorizeUrl
      if (!url) throw new Error('Geen authorize-URL ontvangen van de server.')
      window.location.assign(url)
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : `${PROVIDER_LABEL[provider]} OAuth start mislukt.`
      const message =
        provider === 'gmail' && rawMessage.includes('/email/oauth/start?provider=gmail')
          ? 'Gmail koppelen is nog niet beschikbaar op deze backend. Gebruik voorlopig Outlook of SMTP/IMAP.'
          : rawMessage
      setBanner({ type: 'error', text: message })
      setOauthLoading((prev) => ({ ...prev, [provider]: false }))
    }
  }

  async function handleDeleteOAuth(id: number) {
    if (!token) return
    try {
      await xanoDelete(`/email/connections/${id}`, token)
      setOauthConnections((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verwijderen mislukt.'
      setBanner({ type: 'error', text: message })
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

  return (
    <div className="h-full py-3">
      <div className="max-w-5xl mx-auto h-full min-h-0 flex flex-col">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-border/50">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text-heading flex items-center gap-2">
              <Mail size={16} className="text-accent" />
              Email accounts
            </h2>
            <p className="text-sm text-text-secondary mt-0.5">
              Koppel Outlook en Gmail via OAuth of voeg een SMTP / IMAP inbox toe.
            </p>
            {tenantLine ? <p className="text-2xs text-text-muted mt-1">{tenantLine}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Dialog.Root open={open} onOpenChange={setOpen}>
              <Dialog.Trigger asChild>
                <Button size="sm">
                  <Plus size={13} />
                  Account koppelen
                </Button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/45 z-40" />
                <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[760px] max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-bg-surface p-4 shadow-xl">
                  <div className="flex items-center justify-between mb-3">
                    <Dialog.Title className="text-sm font-semibold text-text-heading">Account koppelen</Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" className="p-1 rounded text-text-muted hover:text-text-primary">
                        <X size={14} />
                      </button>
                    </Dialog.Close>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                    {providerOptions.map((providerOption) => (
                      <button
                        key={providerOption.id}
                        type="button"
                        onClick={() => setModalProvider(providerOption.id)}
                        className={`rounded-md border px-3 py-2 text-left transition-colors ${
                          modalProvider === providerOption.id
                            ? 'border-accent bg-accent/10'
                            : 'border-border/60 hover:border-border'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <ProviderLogo provider={providerOption.id} className="h-6 w-6 object-contain mt-0.5" />
                          <div>
                            <p className="text-xs font-medium text-text-heading">{PROVIDER_LABEL[providerOption.id]}</p>
                            <p className="text-2xs text-text-muted mt-0.5">{providerOption.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {isSmtp ? (
                    <>
                      <p className="text-2xs text-text-muted mb-3">
                        Deze SMTP/IMAP gegevens worden alleen in deze browsersessie bewaard tot er backend-opslag is.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">Accountnaam</label>
                          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Support inbox" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">Afzender e-mail</label>
                          <Input
                            value={fromEmail}
                            onChange={(e) => setFromEmail(e.target.value)}
                            placeholder="support@bedrijf.nl"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">Afzendernaam</label>
                          <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Bokito Support" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">SMTP host</label>
                          <Input
                            value={smtpHost}
                            onChange={(e) => setSmtpHost(e.target.value)}
                            placeholder="smtp.voorbeeld.nl"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">SMTP poort</label>
                          <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">IMAP host</label>
                          <Input
                            value={imapHost}
                            onChange={(e) => setImapHost(e.target.value)}
                            placeholder="imap.voorbeeld.nl"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">IMAP poort</label>
                          <Input value={imapPort} onChange={(e) => setImapPort(e.target.value)} placeholder="993" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">Gebruikersnaam</label>
                          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mailbox-user" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-text-muted mb-1">Wachtwoord</label>
                          <Input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-md border border-border/60 bg-bg-surface px-3 py-2 text-xs text-text-secondary">
                      Je gaat {PROVIDER_LABEL[modalProvider]} koppelen via OAuth. Na klikken word je doorgestuurd naar de provider login/consent.
                    </div>
                  )}

                  {formError ? <p className="text-xs text-status-error mt-3">{formError}</p> : null}

                  <div className="flex items-center justify-end gap-2 mt-4">
                    <Button size="sm" variant="secondary" onClick={resetForm} disabled={modalOAuthLoading}>
                      Reset
                    </Button>
                    <Button size="sm" onClick={() => void handleModalSubmit()} disabled={modalOAuthLoading || !token}>
                      <Plus size={13} />
                      {isSmtp
                        ? 'Toevoegen'
                        : modalOAuthLoading
                          ? 'Bezig…'
                          : `${PROVIDER_LABEL[modalProvider]} koppelen`}
                    </Button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </div>

        {banner ? (
          <div
            className={`mt-2 rounded-md border px-3 py-2 text-xs ${
              banner.type === 'success'
                ? 'border-status-success/40 bg-status-success/10 text-status-success'
                : 'border-status-error/40 bg-status-error/10 text-status-error'
            }`}
          >
            {banner.text}
            <button
              type="button"
              className="ml-2 underline opacity-80 hover:opacity-100"
              onClick={() => setBanner(null)}
            >
              Sluiten
            </button>
          </div>
        ) : null}

        {listError ? <p className="text-xs text-status-error mt-2">{listError}</p> : null}
        {listLoading ? <p className="text-xs text-text-muted mt-2">Laden…</p> : null}

        <div className="mt-2 flex-1 min-h-0 overflow-auto">
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
                      <div className="text-2xs text-text-muted mt-0.5">
                        Laatste sync: {new Date(connection.lastSyncAt).toLocaleString()}
                      </div>
                    ) : null}
                    {connection.status === 'error' && connection.lastError ? (
                      <div className="text-2xs text-status-error mt-0.5">{connection.lastError}</div>
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLocalSmtpAccounts((prev) => prev.filter((item) => item.id !== account.id))}
                    >
                      <Trash2 size={13} />
                      Verwijderen
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!hasRows && !listLoading ? (
            <div className="py-12 px-4 text-center border border-dashed border-border/60 rounded-lg">
              <div className="flex items-center justify-center gap-3 mb-3">
                <ProviderLogo provider="outlook" className="h-7 w-7 object-contain" />
                <ProviderLogo provider="gmail" className="h-7 w-7 object-contain" />
                <span className="text-text-muted">+</span>
                <ProviderLogo provider="smtp_imap" className="h-7 w-7 object-contain" />
              </div>
              <p className="text-sm font-medium text-text-heading">Nog geen e-mailaccounts gekoppeld</p>
              <p className="text-xs text-text-secondary mt-1">Gebruik hierboven Account koppelen om te starten.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
