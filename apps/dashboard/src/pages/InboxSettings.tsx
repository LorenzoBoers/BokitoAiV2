import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Check,
  Copy,
  Folder,
  Mail,
  MoreHorizontal,
  PenLine,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Star,
  Trash2,
  Wifi,
} from 'lucide-react'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Switch } from '../components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import { SettingsSection } from '../components/layout/SettingsSection'
import { OauthRedirectAlert } from '../components/email/OauthRedirectAlert'
import ProviderLogo from '../components/email/ProviderLogo'
import SignatureEditor from '../components/inbox/SignatureEditor'
import RoutingRulesManager from '../components/inbox/RoutingRulesManager'
import SavedRepliesManager from '../components/inbox/SavedRepliesManager'
import AutomationRulesManager from '../components/inbox/AutomationRulesManager'
import SyncStatusPanel from '../components/inbox/SyncStatusPanel'
import type { MailboxConnection, MailboxProvider, MailboxStatus, RoutingRule } from '../types/inbox'
import { MAILBOX_STATUS_LABELS, MAILBOX_STATUS_VARIANTS } from '../types/inbox'
import { useAuth } from '../context/AuthContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { describeOAuthCallbackSummary, logOAuthRedirectDebugInDev, parseOAuthCallback, providerFriendlyName } from '../lib/email-oauth'
import {
  createRoutingRule,
  deleteRoutingRule,
  getBokitoAddress,
  getConnectionSignature,
  listRoutingRules,
  saveConnectionSignature,
  startOAuthConnection,
  syncMailboxes,
  updateMailboxSettings,
  updateRoutingRule,
  type BokitoAddress,
  type RoutingRuleApi,
} from '../lib/email-api'
import { listMailboxFolders, saveMailboxFolders, type MailboxFolder } from '../lib/inbox-api'

function toMailboxStatus(
  value: 'active' | 'error' | 'revoked' | 'connected' | 'needs_auth' | 'paused',
): MailboxStatus {
  if (value === 'error') return 'error'
  if (value === 'needs_auth') return 'needs_auth'
  if (value === 'paused') return 'paused'
  if (value === 'revoked') return 'token_expired'
  return 'connected'
}

function toMailbox(connection: {
  id: number
  provider: MailboxProvider
  mailboxEmail: string
  displayName: string
  status: 'active' | 'error' | 'revoked' | 'connected' | 'needs_auth' | 'paused'
  lastSyncAt: string | null
  signatureHtml: string | null
  lastError: string | null
  isEnabled: boolean
  isPrimary: boolean
  syncWindowDays: number
}): MailboxConnection {
  return {
    id: connection.id,
    provider: connection.provider,
    email_address: connection.mailboxEmail,
    display_name: connection.displayName,
    status: toMailboxStatus(connection.status),
    last_sync_at: connection.lastSyncAt,
    signature_html: connection.signatureHtml,
    sync_cursor: null,
    sync_enabled: connection.isEnabled,
    is_primary: connection.isPrimary,
    sync_window_days: connection.syncWindowDays,
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

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return 'Never synced'
  const date = new Date(lastSyncAt)
  if (Number.isNaN(date.getTime())) return 'Never synced'
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type InboxSettingsAlert =
  | { kind: 'oauth_success'; message: string }
  | {
      kind: 'oauth_error'
      title: string
      summary: string
      code: string
      detail: string | null
    }
  | { kind: 'simple_error'; message: string }

type MailboxRowActionsProps = {
  mailbox: MailboxConnection
  needsReconnect: boolean
  syncing: boolean
  deleting: boolean
  canMakePrimary: boolean
  /** Built-in Bokito address: push-based, cannot reconnect/sync/remove. */
  builtin: boolean
  onReconnect: () => void
  onSync: () => void
  onFolders: () => void
  onSignature: () => void
  onRouting: () => void
  onMakePrimary: () => void
  onRemove: () => void
}

function MailboxRowActions({
  mailbox,
  needsReconnect,
  syncing,
  deleting,
  canMakePrimary,
  builtin,
  onReconnect,
  onSync,
  onFolders,
  onSignature,
  onRouting,
  onMakePrimary,
  onRemove,
}: MailboxRowActionsProps) {
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-border/60 bg-bg-surface">
      {needsReconnect ? (
        <button
          type="button"
          onClick={onReconnect}
          className="inline-flex items-center gap-1.5 border-r border-border/60 px-2.5 text-xs font-medium text-text-heading transition-colors hover:bg-bg-hover/70"
        >
          <Wifi size={13} />
          Reconnect
        </button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${mailbox.email_address}`}
            className="inline-flex h-8 w-8 items-center justify-center text-text-secondary hover:bg-bg-hover/70 hover:text-text-primary"
          >
            <MoreHorizontal size={15} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {!needsReconnect && !builtin ? (
            <DropdownMenuItem className="gap-2 text-xs" disabled={syncing} onSelect={onSync}>
              <RefreshCw size={13} />
              Sync now
            </DropdownMenuItem>
          ) : null}
          {mailbox.provider === 'outlook' ? (
            <DropdownMenuItem className="gap-2 text-xs" onSelect={onFolders}>
              <Folder size={13} />
              Folders
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="gap-2 text-xs" onSelect={onSignature}>
            <PenLine size={13} />
            Signature
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 text-xs" onSelect={onRouting}>
            <SettingsIcon size={13} />
            Routing
          </DropdownMenuItem>
          {!mailbox.is_primary ? (
            <DropdownMenuItem
              className="gap-2 text-xs"
              disabled={!canMakePrimary}
              onSelect={onMakePrimary}
            >
              <Star size={13} />
              Make primary
            </DropdownMenuItem>
          ) : null}
          {!builtin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-xs text-status-error focus:text-status-error"
                disabled={deleting}
                onSelect={onRemove}
              >
                <Trash2 size={13} />
                Remove
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default function InboxSettings() {
  const { token } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const { connections, loading, error, refresh, removeConnection } = useMailboxConnections()
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [signatureEditorOpen, setSignatureEditorOpen] = useState(false)
  const [routingRulesOpen, setRoutingRulesOpen] = useState(false)
  const [selectedMailbox, setSelectedMailbox] = useState<MailboxConnection | null>(null)
  const [routingRules, setRoutingRules] = useState<Record<number, RoutingRule[]>>({})
  const [connectProvider, setConnectProvider] = useState<MailboxProvider>('outlook')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [mailboxSavingId, setMailboxSavingId] = useState<number | null>(null)
  const [pageAlert, setPageAlert] = useState<InboxSettingsAlert | null>(null)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderMailbox, setFolderMailbox] = useState<MailboxConnection | null>(null)
  const [folders, setFolders] = useState<MailboxFolder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [foldersSaving, setFoldersSaving] = useState(false)
  const [foldersError, setFoldersError] = useState<string | null>(null)
  const [deleteMailbox, setDeleteMailbox] = useState<MailboxConnection | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [bokitoAddress, setBokitoAddress] = useState<BokitoAddress | null>(null)
  const [addressCopied, setAddressCopied] = useState(false)

  const mailboxes = useMemo(() => connections.map(toMailbox), [connections])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    getBokitoAddress(token)
      .then((result) => {
        if (cancelled) return
        setBokitoAddress(result)
        // First call may lazily create the mailbox row server-side.
        void refresh()
      })
      .catch(() => {
        // Non-blocking: the card simply stays hidden when unavailable.
      })
    return () => {
      cancelled = true
    }
  }, [token, refresh])

  const handleCopyBokitoAddress = useCallback(async () => {
    if (!bokitoAddress?.address) return
    try {
      await navigator.clipboard.writeText(bokitoAddress.address)
      setAddressCopied(true)
      window.setTimeout(() => setAddressCopied(false), 2000)
    } catch {
      toast.error('Could not copy the address.')
    }
  }, [bokitoAddress])

  const handleSyncNow = useCallback(async () => {
    if (!token || syncing) return
    setSyncing(true)
    try {
      const result = await syncMailboxes(token)
      toast.success(
        result.synced > 0
          ? `Synced ${result.synced} new message${result.synced === 1 ? '' : 's'}`
          : 'Mailboxes synced — no new messages',
      )
      await refresh()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not sync mailboxes.'))
    } finally {
      setSyncing(false)
    }
  }, [token, syncing, refresh])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteMailbox) return
    setDeletingId(deleteMailbox.id)
    setDeleteError(null)
    try {
      await removeConnection(deleteMailbox.id)
      setDeleteMailbox(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Mailbox could not be removed.')
    } finally {
      setDeletingId(null)
    }
  }, [deleteMailbox, removeConnection])

  useEffect(() => {
    const callback = parseOAuthCallback(searchParams)
    if (!callback.handled) return

    logOAuthRedirectDebugInDev(searchParams, callback)

    if (callback.status === 'connected' && callback.provider) {
      setPageAlert({
        kind: 'oauth_success',
        message: `${providerFriendlyName(callback.provider)} connected successfully.`,
      })
      void refresh()
    } else if (callback.error) {
      setPageAlert({
        kind: 'oauth_error',
        title: `Failed to connect ${providerFriendlyName(callback.provider ?? 'outlook')}`,
        summary: describeOAuthCallbackSummary(callback),
        code: callback.error,
        detail: callback.detail,
      })
    }
    const next = new URLSearchParams(searchParams)
    next.delete('oauth_provider')
    next.delete('oauth_status')
    next.delete('oauth_error')
    next.delete('outlook')
    next.delete('outlook_error')
    next.delete('aad_detail')
    next.delete('oauth_detail')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, refresh])

  const persistMailboxFlags = useCallback(
    async (
      mailboxId: number,
      payload: { is_enabled?: boolean; is_primary?: boolean; sync_window_days?: number },
    ) => {
      if (!token) return
      setMailboxSavingId(mailboxId)
      try {
        await updateMailboxSettings(token, mailboxId, payload)
        await refresh()
      } catch (err) {
        setPageAlert({
          kind: 'simple_error',
          message: err instanceof Error ? err.message : 'Failed to save mailbox settings.',
        })
      } finally {
        setMailboxSavingId(null)
      }
    },
    [token, refresh],
  )

  const handleToggleSyncEnabled = useCallback(
    (mailbox: MailboxConnection, enabled: boolean) => {
      const is_primary = enabled ? mailbox.is_primary : false
      void persistMailboxFlags(mailbox.id, { is_enabled: enabled, is_primary })
    },
    [persistMailboxFlags],
  )

  const handleSetPrimaryMailbox = useCallback(
    (mailbox: MailboxConnection) => {
      if (!mailbox.sync_enabled) return
      void persistMailboxFlags(mailbox.id, { is_enabled: true, is_primary: true })
    },
    [persistMailboxFlags],
  )

  const handleChangeSyncWindow = useCallback(
    (mailbox: MailboxConnection, days: number) => {
      void persistMailboxFlags(mailbox.id, { sync_window_days: days })
    },
    [persistMailboxFlags],
  )

  const handleConnect = useCallback(async () => {
    if (!token) return
    setConnectError(null)
    try {
      const url = await startOAuthConnection(token, connectProvider)
      if (!url.trim()) {
        setConnectError('No authorize URL received from the server.')
        return
      }
      window.location.assign(url)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to connect mailbox.')
    }
  }, [token, connectProvider])

  const handleEditSignature = useCallback(
    async (mailbox: MailboxConnection) => {
      if (!token) return
      try {
        const signature = await getConnectionSignature(token, mailbox.id)
        setSelectedMailbox({ ...mailbox, signature_html: signature })
        setSignatureEditorOpen(true)
      } catch (err) {
        toast.error(formatApiErrorMessage(err, 'Could not load signature.'))
      }
    },
    [token],
  )

  const handleSaveSignature = useCallback(
    async (signature: string) => {
      if (!token || !selectedMailbox) return
      try {
        await saveConnectionSignature(token, selectedMailbox.id, signature)
        setSignatureEditorOpen(false)
        toast.success('Signature saved')
        await refresh()
      } catch (err) {
        toast.error(formatApiErrorMessage(err, 'Could not save signature.'))
      }
    },
    [token, selectedMailbox, refresh],
  )

  const handleEditRouting = useCallback(
    async (mailbox: MailboxConnection) => {
      if (!token) return
      try {
        const rows = await listRoutingRules(token, mailbox.id)
        setRoutingRules((prev) => ({ ...prev, [mailbox.id]: rows.map(mapRuleToComponent) }))
        setSelectedMailbox(mailbox)
        setRoutingRulesOpen(true)
      } catch (err) {
        toast.error(formatApiErrorMessage(err, 'Could not load routing rules.'))
      }
    },
    [token],
  )

  const handleSaveRoutingRules = useCallback(
    async (rules: RoutingRule[]) => {
      if (!token || !selectedMailbox) return
      try {
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
        toast.success('Routing rules saved')
      } catch (err) {
        toast.error(formatApiErrorMessage(err, 'Could not save routing rules.'))
      }
    },
    [token, selectedMailbox],
  )

  const handleEditFolders = useCallback(
    async (mailbox: MailboxConnection) => {
      if (!token) return
      setFolderMailbox(mailbox)
      setFoldersError(null)
      setFolders([])
      setFolderDialogOpen(true)
      setFoldersLoading(true)
      try {
        const result = await listMailboxFolders(token, mailbox.id)
        setFolders(result)
      } catch (err) {
        setFoldersError(err instanceof Error ? err.message : 'Failed to load folders.')
      } finally {
        setFoldersLoading(false)
      }
    },
    [token],
  )

  const handleToggleFolder = useCallback((folderId: string) => {
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, isSelected: !f.isSelected } : f)))
  }, [])

  const handleSaveFolders = useCallback(async () => {
    if (!token || !folderMailbox) return
    setFoldersSaving(true)
    setFoldersError(null)
    try {
      await saveMailboxFolders(
        token,
        folderMailbox.id,
        folders.map((f) => ({ id: f.id, display_name: f.displayName, is_selected: f.isSelected })),
      )
      setFolderDialogOpen(false)
    } catch (err) {
      setFoldersError(err instanceof Error ? err.message : 'Failed to save folders.')
    } finally {
      setFoldersSaving(false)
    }
  }, [token, folderMailbox, folders])

  return (
    <PageContent width="full" className="flex min-h-0 flex-col gap-5">
      <PageIntro description="Manage connected mailboxes, signatures, routing and email handling." />

      {pageAlert?.kind === 'oauth_success' ? (
        <OauthRedirectAlert variant="success" onDismiss={() => setPageAlert(null)}>
          {pageAlert.message}
        </OauthRedirectAlert>
      ) : null}
      {pageAlert?.kind === 'oauth_error' ? (
        <OauthRedirectAlert
          variant="error"
          title={pageAlert.title}
          errorCode={pageAlert.code}
          technicalDetail={pageAlert.detail}
          onDismiss={() => setPageAlert(null)}
        >
          {pageAlert.summary}
        </OauthRedirectAlert>
      ) : null}
      {pageAlert?.kind === 'simple_error' ? (
        <div className="rounded-lg border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
          <div className="flex flex-wrap items-start justify-between gap-2 gap-x-4">
            <span className="min-w-0 flex-1 leading-snug">{pageAlert.message}</span>
            <button
              type="button"
              className="shrink-0 underline opacity-90 hover:opacity-100"
              onClick={() => setPageAlert(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <LoadingBlock variant="inline" label="Loading mailboxes…" /> : null}
      {error ? <p className="text-sm text-status-error">{error}</p> : null}

        {bokitoAddress?.address ? (
          <section className="panel flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Mail size={15} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-text-heading">Your Bokito address</h3>
                  <Badge variant="success" className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide">
                    Ready
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Built in and ready to receive. Share it directly or set up forwarding from your
                  existing mailbox — incoming mail lands in your inbox and replies are sent from
                  this address.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className="rounded-md border border-border/60 bg-bg-elevated px-2.5 py-1.5 text-xs font-medium text-text-heading">
                {bokitoAddress.address}
              </code>
              <Button variant="secondary" size="sm" onClick={() => void handleCopyBokitoAddress()}>
                {addressCopied ? <Check size={14} /> : <Copy size={14} />}
                {addressCopied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </section>
        ) : null}

        <SettingsSection
          title="Connected inboxes"
          description="Manage mailbox connections, signatures and routing per inbox."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={syncing || mailboxes.length === 0}
                onClick={() => void handleSyncNow()}
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : undefined} />
                {syncing ? 'Syncing...' : 'Sync now'}
              </Button>
              <Button size="sm" onClick={() => setConnectDialogOpen(true)}>
                <Plus size={14} />
                Connect mailbox
              </Button>
            </div>
          }
          className="overflow-hidden"
          bodyClassName="p-0"
        >
          <Table embedded>
            <TableHeader>
              <TableRow>
                <TableHead>Inbox</TableHead>
                <TableHead>Sync</TableHead>
                <TableHead>History</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && mailboxes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-text-muted">
                    No inbox connected yet
                  </TableCell>
                </TableRow>
              ) : (
                mailboxes.map((mailbox) => {
                  const statusVariant = MAILBOX_STATUS_VARIANTS[mailbox.status]
                  const builtin = mailbox.provider === 'bokito'
                  const needsReconnect =
                    !builtin &&
                    (mailbox.status === 'token_expired' ||
                      mailbox.status === 'needs_auth' ||
                      mailbox.status === 'error')

                  return (
                    <TableRow key={mailbox.id}>
                      <TableCell>
                        <div className="flex items-start gap-3">
                          <ProviderLogo
                            provider={mailbox.provider}
                            className="mt-0.5 h-5 w-5 shrink-0 object-contain"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-text-heading">{mailbox.display_name}</span>
                              {mailbox.is_primary ? (
                                <Badge variant="success" className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide">
                                  Primary
                                </Badge>
                              ) : null}
                            </div>
                            <div className="text-xs text-text-secondary">{mailbox.email_address}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={mailbox.sync_enabled}
                          disabled={mailboxSavingId === mailbox.id}
                          onCheckedChange={(checked) => handleToggleSyncEnabled(mailbox, checked)}
                          aria-label="Toggle inbox sync"
                        />
                      </TableCell>
                      <TableCell>
                        {builtin ? (
                          <span className="text-xs text-text-muted" title="Mail is delivered instantly; no backfill applies">
                            Instant
                          </span>
                        ) : (
                          <select
                            value={String(mailbox.sync_window_days)}
                            disabled={mailboxSavingId === mailbox.id}
                            onChange={(e) => handleChangeSyncWindow(mailbox, Number(e.target.value))}
                            aria-label="How far back to sync mail history"
                            title="How far back mail is backfilled when this mailbox (re)connects"
                            className="h-8 rounded-md border border-border/60 bg-bg-elevated px-2 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-border-focus disabled:opacity-40"
                          >
                            {![7, 30, 90, 365, 0].includes(mailbox.sync_window_days) ? (
                              <option value={String(mailbox.sync_window_days)}>
                                {mailbox.sync_window_days} days
                              </option>
                            ) : null}
                            <option value="7">7 days</option>
                            <option value="30">30 days</option>
                            <option value="90">90 days</option>
                            <option value="365">1 year</option>
                            <option value="0">Everything</option>
                          </select>
                        )}
                      </TableCell>
                      <TableCell>
                        <div>
                          <Badge variant={statusVariant}>{MAILBOX_STATUS_LABELS[mailbox.status]}</Badge>
                          <div className="mt-1 text-xs text-text-muted">
                            {builtin ? 'Delivered in real time' : formatLastSync(mailbox.last_sync_at)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <MailboxRowActions
                          mailbox={mailbox}
                          needsReconnect={needsReconnect}
                          syncing={syncing}
                          builtin={builtin}
                          deleting={deletingId === mailbox.id}
                          canMakePrimary={mailbox.sync_enabled && mailboxSavingId !== mailbox.id}
                          onReconnect={() => setConnectDialogOpen(true)}
                          onSync={() => void handleSyncNow()}
                          onFolders={() => void handleEditFolders(mailbox)}
                          onSignature={() => void handleEditSignature(mailbox)}
                          onRouting={() => void handleEditRouting(mailbox)}
                          onMakePrimary={() => handleSetPrimaryMailbox(mailbox)}
                          onRemove={() => {
                            setDeleteError(null)
                            setDeleteMailbox(mailbox)
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </SettingsSection>

        {mailboxes.length > 0 ? <SyncStatusPanel className="panel p-4" /> : null}

        <AutomationRulesManager />

        <SavedRepliesManager />

        <Dialog.Root open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-w-[92vw] bg-bg-surface border border-border rounded-lg p-5 shadow-xl">
              <Dialog.Title className="text-lg font-semibold text-text-heading mb-3">Connect mailbox</Dialog.Title>
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
                      <span className="inline-flex items-center gap-2">
                        <ProviderLogo provider={provider} className="h-4 w-4 object-contain" />
                        <span>{provider === 'outlook' ? 'Outlook' : 'Gmail'}</span>
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled
                    className="col-span-2 cursor-not-allowed rounded-md border border-border/60 px-3 py-2 text-sm text-text-muted opacity-70"
                    title="Connect any mailbox over SMTP/IMAP — coming soon"
                  >
                    <span className="inline-flex w-full items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2">
                        <ProviderLogo provider="smtp_imap" className="h-4 w-4 object-contain" />
                        <span>SMTP / IMAP</span>
                      </span>
                      <Badge variant="neutral" className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide">
                        Coming soon
                      </Badge>
                    </span>
                  </button>
                </div>
                <p className="text-xs text-text-muted">After connecting you will be redirected to the provider's OAuth page.</p>
                {connectError ? <p className="text-xs text-status-error">{connectError}</p> : null}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setConnectError(null)
                      setConnectDialogOpen(false)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={() => void handleConnect()}>Connect</Button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root
          open={deleteMailbox != null}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteMailbox(null)
              setDeleteError(null)
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-w-[92vw] bg-bg-surface border border-border rounded-lg p-5 shadow-xl">
              <Dialog.Title className="text-lg font-semibold text-text-heading mb-2">
                Remove mailbox?
              </Dialog.Title>
              <p className="text-sm text-text-secondary mb-4">
                Are you sure you want to disconnect{' '}
                <span className="font-medium text-text-heading">
                  {deleteMailbox?.email_address ?? 'this mailbox'}
                </span>
                ? This cannot be undone.
              </p>
              {deleteError ? <p className="text-xs text-status-error mb-3">{deleteError}</p> : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={deletingId != null}
                  onClick={() => {
                    setDeleteMailbox(null)
                    setDeleteError(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={deletingId != null}
                  onClick={() => void handleConfirmDelete()}
                >
                  {deletingId != null ? 'Removing…' : 'Remove'}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
            <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] max-w-[92vw] bg-bg-surface border border-border rounded-lg p-5 shadow-xl flex flex-col max-h-[80vh]">
              <Dialog.Title className="text-base font-semibold text-text-heading mb-1">
                Select folders to sync
              </Dialog.Title>
              <p className="text-xs text-text-secondary mb-4">
                Choose which folders of {folderMailbox?.email_address ?? 'this mailbox'} are synced to the inbox.
              </p>

              {foldersError ? (
                <p className="text-xs text-status-error mb-3">{foldersError}</p>
              ) : null}

              {foldersLoading ? (
                <div className="flex items-center gap-2 text-sm text-text-muted py-4">
                  <RefreshCw size={14} className="animate-spin" />
                  Loading folders...
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-1 min-h-0 mb-4">
                  {folders.length === 0 ? (
                    <p className="text-xs text-text-muted py-4 text-center">No folders found.</p>
                  ) : (
                    folders.map((folder) => (
                      <label
                        key={folder.id}
                        className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-bg-surface-hover cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={folder.isSelected}
                            onChange={() => handleToggleFolder(folder.id)}
                            className="accent-accent"
                          />
                          <span className="text-sm text-text-heading truncate">{folder.displayName}</span>
                          {folder.totalItems > 0 ? (
                            <span className="text-xs text-text-muted shrink-0">{folder.totalItems}</span>
                          ) : null}
                        </div>
                        {folder.lastSyncAt ? (
                          <span className="text-xs text-text-muted shrink-0 ml-2">
                            {new Date(folder.lastSyncAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </label>
                    ))
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                <Button
                  variant="secondary"
                  onClick={() => setFolderDialogOpen(false)}
                  disabled={foldersSaving}
                >
                  Cancel
                </Button>
                <Button onClick={() => void handleSaveFolders()} disabled={foldersLoading || foldersSaving}>
                  {foldersSaving ? 'Saving...' : 'Save'}
                </Button>
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
    </PageContent>
  )
}