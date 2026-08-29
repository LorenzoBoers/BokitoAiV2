import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MessageSquare, Plus, RefreshCw } from 'lucide-react'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { PageIntro } from '../components/layout/PageIntro'
import { SettingsSection } from '../components/layout/SettingsSection'
import { OauthRedirectAlert } from '../components/email/OauthRedirectAlert'
import SignatureEditor from '../components/inbox/SignatureEditor'
import RoutingRulesManager from '../components/inbox/RoutingRulesManager'
import FoldersAndTagsManager from '../components/inbox/FoldersAndTagsManager'
import SavedRepliesManager from '../components/inbox/SavedRepliesManager'
import AutomationRulesManager from '../components/inbox/AutomationRulesManager'
import ChannelList from '../components/inbox/ChannelList'
import AddChannelDialog from '../components/inbox/AddChannelDialog'
import ProviderLogo from '../components/email/ProviderLogo'
import { BrandMark } from '../components/integrations/BrandMark'
import type { RoutingRule } from '../types/inbox'
import { useAuth } from '../context/AuthContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import {
  describeOAuthCallbackSummary,
  logOAuthRedirectDebugInDev,
  parseOAuthCallback,
  providerFriendlyName,
} from '../lib/email-oauth'
import { cn } from '../lib/utils'
import {
  createRoutingRule,
  deleteRoutingRule,
  getConnectionSignature,
  listRoutingRules,
  saveConnectionSignature,
  syncMailboxes,
  updateRoutingRule,
  type RoutingRuleApi,
} from '../lib/email-api'
import {
  deleteChannel,
  listChannels,
  patchChannel,
  syncChannel,
  type ChannelRow,
} from '../lib/channels-api'
import { listMailboxFolders, saveMailboxFolders, type MailboxFolder } from '../lib/inbox-api'
import { formatAppDateTime } from '../lib/app-locale'
import { WEBSITE_WIDGET_PATH } from '../lib/assistant-settings-path'

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

function formatLastSync(lastSyncAt: string | null, neverLabel: string, language?: string | null): string {
  if (!lastSyncAt) return neverLabel
  const date = new Date(lastSyncAt)
  if (Number.isNaN(date.getTime())) return neverLabel
  return formatAppDateTime(date, language)
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

/** An email channel opened in a mailbox-only dialog (folders, signature, routing). */
type MailboxTarget = { connectionId: number; address: string }

/** Overlapping marks for every connectable channel kind next to the section title. */
function ChannelKindsMark() {
  const chips: ReactNode[] = [
    <ProviderLogo key="outlook" provider="outlook" className="h-[13px] w-[13px] object-contain" />,
    <ProviderLogo key="gmail" provider="gmail" className="h-[13px] w-[13px] object-contain" />,
    <BrandMark key="whatsapp" slug="whatsapp" size={13} />,
    <BrandMark key="slack" slug="slack" size={13} />,
    <MessageSquare key="widget" size={12} className="text-text-secondary" />,
  ]
  return (
    <span className="inline-flex items-center" aria-hidden>
      {chips.map((chip, index) => (
        <span
          key={index}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-elevated shadow-sm',
            index > 0 && '-ml-1.5',
          )}
          style={{ zIndex: chips.length - index }}
        >
          {chip}
        </span>
      ))}
    </span>
  )
}

export default function InboxSettings() {
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  // Numeric email connection ids for the mailbox-only dialogs.
  const { connections, refresh: refreshConnections } = useMailboxConnections()
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [pageAlert, setPageAlert] = useState<InboxSettingsAlert | null>(null)
  const [syncingAll, setSyncingAll] = useState(false)

  const [signatureTarget, setSignatureTarget] = useState<MailboxTarget | null>(null)
  const [signatureHtml, setSignatureHtml] = useState('')
  const [routingTarget, setRoutingTarget] = useState<MailboxTarget | null>(null)
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([])
  const [folderTarget, setFolderTarget] = useState<MailboxTarget | null>(null)
  const [folders, setFolders] = useState<MailboxFolder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [foldersSaving, setFoldersSaving] = useState(false)
  const [foldersError, setFoldersError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ChannelRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const refreshChannels = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      setChannels(await listChannels(token))
      setError(null)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('channelsPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void refreshChannels()
  }, [refreshChannels])

  const hasSyncable = useMemo(
    () => channels.some((row) => row.capabilities.includes('sync')),
    [channels],
  )

  const mailboxTarget = useCallback(
    (row: ChannelRow): MailboxTarget | null => {
      const match = connections.find((connection) => connection.uuid === row.id)
      if (!match) return null
      return { connectionId: match.id, address: row.address }
    },
    [connections],
  )

  const applyRow = useCallback((next: ChannelRow | null) => {
    if (!next) return
    setChannels((prev) => prev.map((row) => (row.id === next.id ? next : row)))
  }, [])

  const handleToggleEnabled = useCallback(
    async (row: ChannelRow, enabled: boolean) => {
      if (!token) return
      setBusyId(row.id)
      try {
        applyRow(
          await patchChannel(token, row.id, {
            is_enabled: enabled,
            // A paused channel should not stay the primary sender.
            ...(enabled ? {} : { is_primary: false }),
          }),
        )
        await refreshConnections()
      } catch (err) {
        setPageAlert({
          kind: 'simple_error',
          message: formatApiErrorMessage(err, t('channelsPage.mailboxSaveError')),
        })
      } finally {
        setBusyId(null)
      }
    },
    [token, applyRow, refreshConnections, t],
  )

  const handleMakePrimary = useCallback(
    async (row: ChannelRow) => {
      if (!token) return
      setBusyId(row.id)
      try {
        applyRow(await patchChannel(token, row.id, { is_primary: true }))
        await refreshChannels()
      } catch (err) {
        setPageAlert({
          kind: 'simple_error',
          message: formatApiErrorMessage(err, t('channelsPage.mailboxSaveError')),
        })
      } finally {
        setBusyId(null)
      }
    },
    [token, applyRow, refreshChannels, t],
  )

  const handleSyncWindowChange = useCallback(
    async (row: ChannelRow, days: number) => {
      if (!token) return
      setBusyId(row.id)
      try {
        applyRow(await patchChannel(token, row.id, { sync_window_days: days }))
        await refreshConnections()
      } catch (err) {
        setPageAlert({
          kind: 'simple_error',
          message: formatApiErrorMessage(err, t('channelsPage.mailboxSaveError')),
        })
      } finally {
        setBusyId(null)
      }
    },
    [token, applyRow, refreshConnections, t],
  )

  const handleSync = useCallback(
    async (row: ChannelRow) => {
      if (!token) return
      setBusyId(row.id)
      try {
        const result = await syncChannel(token, row.id)
        applyRow(result.channel)
        toast.success(
          result.synced > 0
            ? t('channelsPage.syncedCount', { count: result.synced })
            : t('channelsPage.syncedNone'),
        )
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('channelsPage.couldNotSync')))
      } finally {
        setBusyId(null)
      }
    },
    [token, applyRow, t],
  )

  const handleSyncAll = useCallback(async () => {
    if (!token || syncingAll) return
    setSyncingAll(true)
    try {
      const result = await syncMailboxes(token)
      toast.success(
        result.synced > 0
          ? t('channelsPage.syncedCount', { count: result.synced })
          : t('channelsPage.syncedNone'),
      )
      await refreshChannels()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('channelsPage.couldNotSync')))
    } finally {
      setSyncingAll(false)
    }
  }, [token, syncingAll, refreshChannels, t])

  const handleConfirmDelete = useCallback(async () => {
    if (!token || !deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteChannel(token, deleteTarget.id)
      setDeleteTarget(null)
      await refreshChannels()
      await refreshConnections()
    } catch (err) {
      setDeleteError(formatApiErrorMessage(err, t('channelsPage.removeError')))
    } finally {
      setDeleting(false)
    }
  }, [token, deleteTarget, refreshChannels, refreshConnections, t])

  const handleSignature = useCallback(
    async (row: ChannelRow) => {
      if (!token) return
      const target = mailboxTarget(row)
      if (!target) {
        toast.error(t('channelsPage.signatureLoadError'))
        return
      }
      try {
        setSignatureHtml(await getConnectionSignature(token, target.connectionId))
        setSignatureTarget(target)
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('channelsPage.signatureLoadError')))
      }
    },
    [token, mailboxTarget, t],
  )

  const handleSaveSignature = useCallback(
    async (signature: string) => {
      if (!token || !signatureTarget) return
      try {
        await saveConnectionSignature(token, signatureTarget.connectionId, signature)
        setSignatureTarget(null)
        toast.success(t('channelsPage.signatureSaved'))
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('channelsPage.signatureSaveError')))
      }
    },
    [token, signatureTarget, t],
  )

  const handleRouting = useCallback(
    async (row: ChannelRow) => {
      if (!token) return
      const target = mailboxTarget(row)
      if (!target) {
        toast.error(t('channelsPage.routingLoadError'))
        return
      }
      try {
        const rows = await listRoutingRules(token, target.connectionId)
        setRoutingRules(rows.map(mapRuleToComponent))
        setRoutingTarget(target)
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('channelsPage.routingLoadError')))
      }
    },
    [token, mailboxTarget, t],
  )

  const handleSaveRoutingRules = useCallback(
    async (rules: RoutingRule[]) => {
      if (!token || !routingTarget) return
      try {
        const current = await listRoutingRules(token, routingTarget.connectionId)
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
        setRoutingTarget(null)
        toast.success(t('channelsPage.routingSaved'))
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('channelsPage.routingSaveError')))
      }
    },
    [token, routingTarget, t],
  )

  const handleFolders = useCallback(
    async (row: ChannelRow) => {
      if (!token) return
      const target = mailboxTarget(row)
      if (!target) {
        toast.error(t('channelsPage.foldersLoadError'))
        return
      }
      setFolderTarget(target)
      setFoldersError(null)
      setFolders([])
      setFoldersLoading(true)
      try {
        setFolders(await listMailboxFolders(token, target.connectionId))
      } catch (err) {
        setFoldersError(formatApiErrorMessage(err, t('channelsPage.foldersLoadError')))
      } finally {
        setFoldersLoading(false)
      }
    },
    [token, mailboxTarget, t],
  )

  const handleToggleFolder = useCallback((folderId: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, isSelected: !f.isSelected } : f)),
    )
  }, [])

  const handleSaveFolders = useCallback(async () => {
    if (!token || !folderTarget) return
    setFoldersSaving(true)
    setFoldersError(null)
    try {
      await saveMailboxFolders(
        token,
        folderTarget.connectionId,
        folders.map((f) => ({ id: f.id, display_name: f.displayName, is_selected: f.isSelected })),
      )
      setFolderTarget(null)
      await refreshChannels()
    } catch (err) {
      setFoldersError(formatApiErrorMessage(err, t('channelsPage.foldersSaveError')))
    } finally {
      setFoldersSaving(false)
    }
  }, [token, folderTarget, folders, refreshChannels, t])

  useEffect(() => {
    if (!location.hash) return
    const id = location.hash.slice(1)
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [location.hash, loading])

  useEffect(() => {
    const callback = parseOAuthCallback(searchParams)
    if (!callback.handled) return

    logOAuthRedirectDebugInDev(searchParams, callback)

    if (callback.status === 'connected' && callback.provider) {
      setPageAlert({
        kind: 'oauth_success',
        message: t('channelsPage.oauthConnected', {
          provider: providerFriendlyName(callback.provider),
        }),
      })
      void refreshChannels()
    } else if (callback.error) {
      setPageAlert({
        kind: 'oauth_error',
        title: t('channelsPage.oauthFailedTitle', {
          provider: providerFriendlyName(callback.provider ?? 'outlook'),
        }),
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
  }, [searchParams, setSearchParams, refreshChannels, t])

  return (
    <PageContent width="full" className="flex min-h-0 flex-col gap-5">
      <PageGuideBanner page="channels" />
      <PageIntro description={t('pageHeaders.emailMessages')} />

      {channels.some((row) => row.state === 'setup_required' || row.state === 'action_required' || row.state === 'error') ? (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm">
          <p className="font-medium text-text-heading">
            {t('channelsPage.setupNeededAlert.title', {
              count: channels.filter(
                (row) =>
                  row.state === 'setup_required' ||
                  row.state === 'action_required' ||
                  row.state === 'error',
              ).length,
            })}
          </p>
          <p className="mt-1 text-text-secondary">{t('channelsPage.setupNeededAlert.body')}</p>
        </div>
      ) : null}

      <div className="rounded-lg border border-border/60 bg-bg-elevated/40 px-4 py-3 text-sm text-text-secondary">
        <p>{t('channelsPage.crossLinks.body')}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link to="/settings/communication" className="font-medium text-accent hover:underline">
            {t('channelsPage.crossLinks.inboxAi')}
          </Link>
          <Link to={WEBSITE_WIDGET_PATH} className="font-medium text-accent hover:underline">
            {t('channelsPage.crossLinks.widget')}
          </Link>
          <Link to="/settings/marketplace?kind=inbox" className="font-medium text-accent hover:underline">
            {t('channelsPage.crossLinks.integrations')}
          </Link>
        </div>
      </div>

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
              {t('channelsPage.close')}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <LoadingBlock variant="inline" label={t('channelsPage.loadingChannels')} /> : null}
      {error ? <p className="text-sm text-status-error">{error}</p> : null}

      <div id="channels" className="scroll-mt-6">
        <SettingsSection
          title={
            <span className="inline-flex flex-wrap items-center gap-2.5">
              <span>{t('channelsPage.listTitle')}</span>
              <ChannelKindsMark />
            </span>
          }
          description={t('channelsPage.listDescription')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={syncingAll || !hasSyncable}
                onClick={() => void handleSyncAll()}
              >
                <RefreshCw size={14} className={syncingAll ? 'animate-spin' : undefined} />
                {syncingAll ? t('channelsPage.syncing') : t('channelsPage.syncNow')}
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus size={14} />
                {t('channelsPage.addChannel')}
              </Button>
            </div>
          }
          className="overflow-hidden"
          bodyClassName="p-0"
        >
          <ChannelList
            channels={channels}
            loading={loading}
            busyId={busyId}
            onToggleEnabled={(row, enabled) => void handleToggleEnabled(row, enabled)}
            onSync={(row) => void handleSync(row)}
            onReconnect={() => setAddOpen(true)}
            onMakePrimary={(row) => void handleMakePrimary(row)}
            onRemove={(row) => {
              setDeleteError(null)
              setDeleteTarget(row)
            }}
            onSyncWindowChange={(row, days) => void handleSyncWindowChange(row, days)}
            onFolders={(row) => void handleFolders(row)}
            onSignature={(row) => void handleSignature(row)}
            onRouting={(row) => void handleRouting(row)}
            onVisibilityChanged={() => void refreshChannels()}
            onAddChannel={() => setAddOpen(true)}
          />
        </SettingsSection>
      </div>

      <AutomationRulesManager />

      <FoldersAndTagsManager />

      <SavedRepliesManager />

      <AddChannelDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onChannelAdded={() => {
          void refreshChannels()
          void refreshConnections()
        }}
      />

      <Dialog.Root
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-surface p-5 shadow-xl">
            <Dialog.Title className="mb-2 text-lg font-semibold text-text-heading">
              {t('channelsPage.removeTitle')}
            </Dialog.Title>
            <p className="mb-4 text-sm text-text-secondary">
              {t('channelsPage.removeBody', {
                email: deleteTarget?.address || deleteTarget?.label || t('channelsPage.thisChannel'),
              })}
            </p>
            {deleteError ? <p className="mb-3 text-xs text-status-error">{deleteError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={deleting}
                onClick={() => {
                  setDeleteTarget(null)
                  setDeleteError(null)
                }}
              >
                {t('channelsPage.cancel')}
              </Button>
              <Button variant="destructive" disabled={deleting} onClick={() => void handleConfirmDelete()}>
                {deleting ? t('channelsPage.removing') : t('channelsPage.remove')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={folderTarget != null}
        onOpenChange={(open) => {
          if (!open) setFolderTarget(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-bg-surface p-5 shadow-xl">
            <Dialog.Title className="mb-1 text-base font-semibold text-text-heading">
              {t('channelsPage.foldersTitle')}
            </Dialog.Title>
            <p className="mb-4 text-xs text-text-secondary">
              {t('channelsPage.foldersBody', {
                email: folderTarget?.address ?? t('channelsPage.thisMailbox'),
              })}
            </p>

            {foldersError ? <p className="mb-3 text-xs text-status-error">{foldersError}</p> : null}

            {foldersLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-text-muted">
                <RefreshCw size={14} className="animate-spin" />
                {t('channelsPage.loadingFolders')}
              </div>
            ) : (
              <div className="mb-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
                {folders.length === 0 ? (
                  <p className="py-4 text-center text-xs text-text-muted">
                    {t('channelsPage.noFolders')}
                  </p>
                ) : (
                  folders.map((folder) => (
                    <label
                      key={folder.id}
                      className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 hover:bg-bg-surface-hover"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={folder.isSelected}
                          onChange={() => handleToggleFolder(folder.id)}
                          className="accent-accent"
                        />
                        <span className="truncate text-sm text-text-heading">{folder.displayName}</span>
                        {folder.totalItems > 0 ? (
                          <span className="shrink-0 text-xs text-text-muted">{folder.totalItems}</span>
                        ) : null}
                      </div>
                      {folder.lastSyncAt ? (
                        <span className="ml-2 shrink-0 text-xs text-text-muted">
                          {formatLastSync(folder.lastSyncAt, t('channelsPage.neverSynced'), i18n.language)}
                        </span>
                      ) : null}
                    </label>
                  ))
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-border/60 pt-2">
              <Button variant="secondary" onClick={() => setFolderTarget(null)} disabled={foldersSaving}>
                {t('channelsPage.cancel')}
              </Button>
              <Button onClick={() => void handleSaveFolders()} disabled={foldersLoading || foldersSaving}>
                {foldersSaving ? t('channelsPage.saving') : t('channelsPage.save')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {signatureTarget ? (
        <SignatureEditor
          open
          onOpenChange={(open) => {
            if (!open) setSignatureTarget(null)
          }}
          initialSignature={signatureHtml}
          onSave={(signature) => void handleSaveSignature(signature)}
          mailboxEmail={signatureTarget.address}
        />
      ) : null}

      {routingTarget ? (
        <RoutingRulesManager
          open
          onOpenChange={(open) => {
            if (!open) setRoutingTarget(null)
          }}
          mailboxId={routingTarget.connectionId}
          mailboxEmail={routingTarget.address}
          rules={routingRules}
          onSaveRules={(rules) => void handleSaveRoutingRules(rules)}
        />
      ) : null}
    </PageContent>
  )
}
