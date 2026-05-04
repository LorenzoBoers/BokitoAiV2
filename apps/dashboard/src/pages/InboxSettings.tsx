import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Mail, Plus, RefreshCw, Settings as SettingsIcon, Trash2, Wifi, WifiOff } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card } from '../components/ui/card'
import SignatureEditor from '../components/inbox/SignatureEditor'
import RoutingRulesManager from '../components/inbox/RoutingRulesManager'
import type { MailboxConnection, MailboxProvider, MailboxStatus, RoutingRule } from '../types/inbox'
import { MAILBOX_STATUS_LABELS, MAILBOX_STATUS_VARIANTS } from '../types/inbox'
import { useAuth } from '../context/AuthContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import {
  createKbCollection,
  createRoutingRule,
  deleteKbDocument,
  deleteRoutingRule,
  getAiConfig,
  getConnectionSignature,
  listKbCollections,
  listKbDocuments,
  listRoutingRules,
  saveAiConfig,
  saveConnectionSignature,
  startOAuthConnection,
  uploadKbDocument,
  updateRoutingRule,
  type AiInboxConfig,
  type KbCollection,
  type KbDocument,
  type RoutingRuleApi,
} from '../lib/email-api'

function toMailboxStatus(value: 'active' | 'error' | 'revoked'): MailboxStatus {
  if (value === 'error') return 'error'
  if (value === 'revoked') return 'token_expired'
  return 'connected'
}

function toMailbox(connection: {
  id: number
  provider: MailboxProvider
  mailboxEmail: string
  displayName: string
  status: 'active' | 'error' | 'revoked'
  lastSyncAt: string | null
  signatureHtml: string | null
  lastError: string | null
}): MailboxConnection {
  return {
    id: connection.id,
    workspace_id: 1,
    provider: connection.provider,
    email_address: connection.mailboxEmail,
    display_name: connection.displayName,
    status: toMailboxStatus(connection.status),
    last_sync_at: connection.lastSyncAt,
    signature_html: connection.signatureHtml,
    sync_cursor: null,
    error_message: connection.lastError ?? undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapRuleToComponent(rule: RoutingRuleApi): RoutingRule {
  return {
    id: rule.id,
    mailbox_connection_id: rule.mailbox_id,
    condition_type: rule.condition_type,
    condition_value: rule.condition_value,
    assign_to_user_id: rule.assign_to_user_id,
    labels: rule.labels,
    priority: rule.priority,
    active: rule.is_active,
    created_at: rule.created_at,
    updated_at: rule.updated_at,
  }
}

function mapRuleToApi(rule: RoutingRule): Omit<RoutingRuleApi, 'id' | 'created_at' | 'updated_at'> {
  return {
    mailbox_id: rule.mailbox_connection_id,
    priority: rule.priority,
    condition_type: rule.condition_type,
    condition_value: rule.condition_value,
    assign_to_user_id: rule.assign_to_user_id,
    labels: rule.labels,
    is_active: rule.active,
  }
}

function getStatusIcon(status: MailboxStatus) {
  if (status === 'connected') return <CheckCircle size={14} className="text-status-success" />
  if (status === 'syncing') return <RefreshCw size={14} className="text-status-warning animate-spin" />
  if (status === 'error') return <AlertCircle size={14} className="text-status-error" />
  return <WifiOff size={14} className="text-status-warning" />
}

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return 'Nooit gesynchroniseerd'
  return new Date(lastSyncAt).toLocaleString()
}

export default function InboxSettings() {
  const { token } = useAuth()
  const { connections, loading, error, refresh, removeConnection } = useMailboxConnections()
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [signatureEditorOpen, setSignatureEditorOpen] = useState(false)
  const [routingRulesOpen, setRoutingRulesOpen] = useState(false)
  const [selectedMailbox, setSelectedMailbox] = useState<MailboxConnection | null>(null)
  const [routingRules, setRoutingRules] = useState<Record<number, RoutingRule[]>>({})
  const [aiConfig, setAiConfig] = useState<Record<number, AiInboxConfig>>({})
  const [connectProvider, setConnectProvider] = useState<MailboxProvider>('outlook')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [kbCollections, setKbCollections] = useState<KbCollection[]>([])
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null)
  const [kbDocuments, setKbDocuments] = useState<KbDocument[]>([])
  const [newCollectionName, setNewCollectionName] = useState('')
  const [newCollectionDescription, setNewCollectionDescription] = useState('')
  const [newDocName, setNewDocName] = useState('')
  const [newDocUrl, setNewDocUrl] = useState('')
  const [newDocType, setNewDocType] = useState<KbDocument['file_type']>('pdf')

  const mailboxes = useMemo(() => connections.map(toMailbox), [connections])

  const handleConnect = useCallback(async () => {
    if (!token) return
    setConnectError(null)
    try {
      const url = await startOAuthConnection(token, connectProvider)
      if (!url.trim()) {
        setConnectError('Geen authorize-URL ontvangen van de server.')
        return
      }
      window.location.assign(url)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Mailbox koppelen mislukt.')
    }
  }, [token, connectProvider])

  const handleEditSignature = useCallback(
    async (mailbox: MailboxConnection) => {
      if (!token) return
      const signature = await getConnectionSignature(token, mailbox.id)
      setSelectedMailbox({ ...mailbox, signature_html: signature })
      setSignatureEditorOpen(true)
    },
    [token],
  )

  const handleSaveSignature = useCallback(
    async (signature: string) => {
      if (!token || !selectedMailbox) return
      await saveConnectionSignature(token, selectedMailbox.id, signature)
      setSignatureEditorOpen(false)
      await refresh()
    },
    [token, selectedMailbox, refresh],
  )

  const handleEditRouting = useCallback(
    async (mailbox: MailboxConnection) => {
      if (!token) return
      const rows = await listRoutingRules(token, mailbox.id)
      setRoutingRules((prev) => ({ ...prev, [mailbox.id]: rows.map(mapRuleToComponent) }))
      setSelectedMailbox(mailbox)
      setRoutingRulesOpen(true)
    },
    [token],
  )

  const handleSaveRoutingRules = useCallback(
    async (rules: RoutingRule[]) => {
      if (!token || !selectedMailbox) return
      const current = await listRoutingRules(token, selectedMailbox.id)
      const currentById = new Map(current.map((item) => [item.id, item]))
      const nextById = new Map(rules.filter((item) => item.id > 0).map((item) => [item.id, item]))

      for (const rule of rules) {
        if (currentById.has(rule.id)) {
          await updateRoutingRule(token, rule.id, {
            priority: rule.priority,
            condition_type: rule.condition_type,
            condition_value: rule.condition_value,
            assign_to_user_id: rule.assign_to_user_id,
            labels: rule.labels,
            is_active: rule.active,
          })
        } else {
          await createRoutingRule(token, mapRuleToApi(rule))
        }
      }

      for (const existing of current) {
        if (!nextById.has(existing.id)) {
          await deleteRoutingRule(token, existing.id)
        }
      }
      setRoutingRulesOpen(false)
    },
    [token, selectedMailbox],
  )

  useEffect(() => {
    if (!token) return
    void (async () => {
      const entries = await Promise.all(
        mailboxes.map(async (mailbox) => ({
          id: mailbox.id,
          config: await getAiConfig(token, mailbox.id),
        })),
      )
      setAiConfig(Object.fromEntries(entries.map((entry) => [entry.id, entry.config])))
    })()
  }, [token, mailboxes])

  const handleSaveAiConfig = useCallback(
    async (mailboxId: number, config: AiInboxConfig) => {
      if (!token) return
      setAiConfig((prev) => ({ ...prev, [mailboxId]: config }))
      await saveAiConfig(token, mailboxId, config)
    },
    [token],
  )

  const refreshKbCollections = useCallback(async () => {
    if (!token) return
    const rows = await listKbCollections(token)
    setKbCollections(rows)
    if (!selectedCollectionId && rows.length > 0) {
      setSelectedCollectionId(rows[0].id)
    }
  }, [token, selectedCollectionId])

  const refreshKbDocuments = useCallback(async () => {
    if (!token || !selectedCollectionId) return
    const rows = await listKbDocuments(token, selectedCollectionId)
    setKbDocuments(rows)
  }, [token, selectedCollectionId])

  useEffect(() => {
    void refreshKbCollections()
  }, [refreshKbCollections])

  useEffect(() => {
    void refreshKbDocuments()
  }, [refreshKbDocuments])

  return (
    <div className="h-full py-6">
      <div className="max-w-5xl mx-auto h-full min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-text-heading flex items-center gap-2">
              <Mail size={20} className="text-accent" />
              Inbox instellingen
            </h1>
            <p className="text-sm text-text-secondary mt-1">Beheer verbonden mailboxen, handtekeningen, routing en AI-instellingen.</p>
          </div>
          <Button onClick={() => setConnectDialogOpen(true)}>
            <Plus size={16} />
            Mailbox verbinden
          </Button>
        </div>

        {loading ? <div className="text-sm text-text-muted">Mailboxen laden...</div> : null}
        {error ? <div className="text-sm text-status-error">{error}</div> : null}

        <div className="space-y-4">
          {mailboxes.map((mailbox) => {
            const statusVariant = MAILBOX_STATUS_VARIANTS[mailbox.status]
            const needsReconnect = mailbox.status === 'token_expired' || mailbox.status === 'error'
            const cfg =
              aiConfig[mailbox.id] ?? {
                suggestions_enabled: true,
                auto_reply_enabled: false,
                auto_reply_threshold: 0.85,
                auto_label_enabled: false,
                tone: 'formeel' as const,
                language: 'nl' as const,
              }
            return (
              <Card key={mailbox.id} className="p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-text-heading">{mailbox.display_name}</h3>
                      <div className="flex items-center gap-1">
                        {getStatusIcon(mailbox.status)}
                        <Badge variant={statusVariant}>{MAILBOX_STATUS_LABELS[mailbox.status]}</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-text-secondary">{mailbox.email_address}</p>
                    <p className="text-xs text-text-muted mt-1">Laatste sync: {formatLastSync(mailbox.last_sync_at)}</p>
                  </div>

                  <div className="flex items-center gap-1">
                    {needsReconnect ? (
                      <Button size="sm" variant="secondary" onClick={() => setConnectDialogOpen(true)}>
                        <Wifi size={13} />
                        Herverbinden
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                        <RefreshCw size={13} />
                        Sync nu
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => void handleEditSignature(mailbox)}>
                      Handtekening
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void handleEditRouting(mailbox)}>
                      <SettingsIcon size={13} />
                      Routing
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void removeConnection(mailbox.id)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cfg.suggestions_enabled}
                      onChange={(event) =>
                        void handleSaveAiConfig(mailbox.id, { ...cfg, suggestions_enabled: event.target.checked })
                      }
                    />
                    AI suggesties
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cfg.auto_reply_enabled}
                      onChange={(event) =>
                        void handleSaveAiConfig(mailbox.id, { ...cfg, auto_reply_enabled: event.target.checked })
                      }
                    />
                    Auto-reply
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cfg.auto_label_enabled}
                      onChange={(event) =>
                        void handleSaveAiConfig(mailbox.id, { ...cfg, auto_label_enabled: event.target.checked })
                      }
                    />
                    Auto-label
                  </label>
                  <label className="flex items-center gap-2">
                    Drempel: {(cfg.auto_reply_threshold * 100).toFixed(0)}%
                    <input
                      type="range"
                      min={50}
                      max={95}
                      value={Math.round(cfg.auto_reply_threshold * 100)}
                      onChange={(event) =>
                        void handleSaveAiConfig(mailbox.id, {
                          ...cfg,
                          auto_reply_threshold: Number(event.target.value) / 100,
                        })
                      }
                    />
                  </label>
                </div>
              </Card>
            )
          })}
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <h2 className="text-lg font-semibold text-text-heading mb-2">Knowledge base</h2>
          <p className="text-sm text-text-secondary mb-4">Beheer collectiebronnen voor AI-context en documentindexering.</p>

          <Card className="p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
              <input
                className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
                placeholder="Nieuwe collectie naam"
                value={newCollectionName}
                onChange={(event) => setNewCollectionName(event.target.value)}
              />
              <input
                className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
                placeholder="Beschrijving (optioneel)"
                value={newCollectionDescription}
                onChange={(event) => setNewCollectionDescription(event.target.value)}
              />
              <Button
                onClick={() =>
                  void (async () => {
                    if (!token || !newCollectionName.trim()) return
                    await createKbCollection(token, newCollectionName.trim(), newCollectionDescription.trim() || undefined)
                    setNewCollectionName('')
                    setNewCollectionDescription('')
                    await refreshKbCollections()
                  })()
                }
              >
                Toevoegen
              </Button>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
            <Card className="p-3">
              <div className="text-xs text-text-muted mb-2">Collecties</div>
              <div className="space-y-1">
                {kbCollections.map((collection) => (
                  <button
                    key={collection.id}
                    type="button"
                    onClick={() => setSelectedCollectionId(collection.id)}
                    className={`w-full text-left rounded-md border px-2 py-2 text-sm ${
                      selectedCollectionId === collection.id
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-text-secondary'
                    }`}
                  >
                    <div>{collection.name}</div>
                    <div className="text-2xs opacity-80">{collection.document_count} documenten</div>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-3">
              <div className="text-xs text-text-muted mb-2">Documenten</div>
              {selectedCollectionId ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_auto] gap-2 mb-3">
                    <input
                      className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
                      placeholder="Bestandsnaam"
                      value={newDocName}
                      onChange={(event) => setNewDocName(event.target.value)}
                    />
                    <input
                      className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
                      placeholder="Bestand URL"
                      value={newDocUrl}
                      onChange={(event) => setNewDocUrl(event.target.value)}
                    />
                    <select
                      className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
                      value={newDocType}
                      onChange={(event) => setNewDocType(event.target.value as KbDocument['file_type'])}
                    >
                      {['pdf', 'docx', 'txt', 'md', 'csv'].map((type) => (
                        <option key={type} value={type}>
                          {type.toUpperCase()}
                        </option>
                      ))}
                    </select>
                    <Button
                      onClick={() =>
                        void (async () => {
                          if (!token || !newDocName.trim() || !newDocUrl.trim()) return
                          await uploadKbDocument(token, selectedCollectionId, {
                            filename: newDocName.trim(),
                            file_url: newDocUrl.trim(),
                            file_type: newDocType,
                          })
                          setNewDocName('')
                          setNewDocUrl('')
                          await refreshKbDocuments()
                          await refreshKbCollections()
                        })()
                      }
                    >
                      Upload
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {kbDocuments.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm text-text-primary truncate">{doc.filename}</div>
                          <div className="text-2xs text-text-muted">
                            {doc.file_type.toUpperCase()} - status: {doc.index_status}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void (async () => {
                              if (!token) return
                              await deleteKbDocument(token, doc.id)
                              await refreshKbDocuments()
                              await refreshKbCollections()
                            })()
                          }
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-sm text-text-muted">Selecteer eerst een collectie.</div>
              )}
            </Card>
          </div>
        </div>

        <Dialog.Root open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-w-[92vw] bg-bg-surface border border-border rounded-lg p-5 shadow-xl">
              <Dialog.Title className="text-lg font-semibold text-text-heading mb-3">Mailbox verbinden</Dialog.Title>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {(['outlook', 'gmail'] as const).map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => setConnectProvider(provider)}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        connectProvider === provider
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border text-text-secondary'
                      }`}
                    >
                      {provider === 'outlook' ? 'Outlook' : 'Gmail'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-muted">Na verbinden word je doorgestuurd naar de provider OAuth pagina.</p>
                {connectError ? <p className="text-xs text-status-error">{connectError}</p> : null}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setConnectError(null)
                      setConnectDialogOpen(false)
                    }}
                  >
                    Annuleren
                  </Button>
                  <Button onClick={() => void handleConnect()}>Verbinden</Button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {selectedMailbox ? (
          <>
            <SignatureEditor
              open={signatureEditorOpen}
              onOpenChange={setSignatureEditorOpen}
              initialSignature={selectedMailbox.signature_html || ''}
              onSave={(signature) => void handleSaveSignature(signature)}
              mailboxEmail={selectedMailbox.email_address}
            />

            <RoutingRulesManager
              open={routingRulesOpen}
              onOpenChange={setRoutingRulesOpen}
              mailboxId={selectedMailbox.id}
              mailboxEmail={selectedMailbox.email_address}
              rules={routingRules[selectedMailbox.id] || []}
              onSaveRules={(rules) => void handleSaveRoutingRules(rules)}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}