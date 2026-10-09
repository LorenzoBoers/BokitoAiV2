import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideLink } from '../components/layout/PageGuideLink'
import ChannelPanel from '../components/channels/ChannelPanel'
import { type ChannelActions } from '../components/channels/channel-actions'
import SignatureEditor from '../components/inbox/SignatureEditor'
import AddChannelDialog from '../components/inbox/AddChannelDialog'
import { ChannelWidgetEditor } from './MessengerSettings'
import { useAuth } from '../context/AuthContext'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import {
  archiveChannel,
  deleteChannel,
  getChannel,
  patchChannel,
  restoreChannel,
  syncChannel,
  type ChannelRow,
} from '../lib/channels-api'
import {
  getConnectionSignature,
  saveConnectionSignature,
  type SignatureSource,
} from '../lib/email-api'
import { listMailboxFolders, saveMailboxFolders, type MailboxFolder } from '../lib/inbox-api'
import { cn } from '../lib/utils'
import type { AssistantSection } from '../lib/assistant-settings-path'

type MailboxTarget = { connectionId: number; address: string }
type WidgetTab = 'general' | 'look' | 'hours' | 'install'

const WIDGET_TABS: WidgetTab[] = ['general', 'look', 'hours', 'install']

function widgetSection(tab: WidgetTab): AssistantSection | null {
  if (tab === 'look') return 'customization'
  if (tab === 'hours') return 'hours'
  if (tab === 'install') return 'installation'
  return null
}

export default function ChannelDetailPage() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const navigate = useNavigate()
  const { channelId } = useParams<{ channelId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { connections, refresh: refreshConnections } = useMailboxConnections()

  const [row, setRow] = useState<ChannelRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [deleteDraft, setDeleteDraft] = useState('')

  const [signatureTarget, setSignatureTarget] = useState<MailboxTarget | null>(null)
  const [signatureHtml, setSignatureHtml] = useState('')
  const [signatureSource, setSignatureSourceState] = useState<SignatureSource>('mailbox')
  const [folderTarget, setFolderTarget] = useState<MailboxTarget | null>(null)
  const [folders, setFolders] = useState<MailboxFolder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [foldersSaving, setFoldersSaving] = useState(false)
  const [foldersError, setFoldersError] = useState<string | null>(null)

  const tabParam = searchParams.get('tab')
  const tab: WidgetTab =
    row?.kind === 'widget' && WIDGET_TABS.includes(tabParam as WidgetTab) ? (tabParam as WidgetTab) : 'general'

  const load = useCallback(async () => {
    if (!token || !channelId) return
    setLoading(true)
    try {
      const next = await getChannel(token, channelId)
      if (!next) {
        setError(t('channelsPage.notFound'))
        setRow(null)
      } else {
        setRow(next)
        setError(null)
      }
    } catch (err) {
      setError(formatApiErrorMessage(err, t('channelsPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [token, channelId, t])

  useEffect(() => {
    void load()
  }, [load])

  const mailboxTarget = useCallback(
    (channel: ChannelRow): MailboxTarget | null => {
      const match = connections.find((connection) => connection.uuid === channel.id)
      if (!match) return null
      return { connectionId: match.id, address: channel.address }
    },
    [connections],
  )

  const apply = useCallback((next: ChannelRow | null) => {
    if (next) setRow(next)
  }, [])

  const actions: ChannelActions = useMemo(
    () => ({
      setPaused: (channel, paused) => {
        if (!token) return
        setBusy(true)
        void patchChannel(token, channel.id, {
          is_enabled: !paused,
          ...(paused ? { is_primary: false } : {}),
        })
          .then(apply)
          .catch((err) => toast.error(formatApiErrorMessage(err, t('channelsPage.mailboxSaveError'))))
          .finally(() => setBusy(false))
      },
      sync: (channel) => {
        if (!token) return
        setBusy(true)
        void syncChannel(token, channel.id)
          .then((result) => {
            apply(result.channel)
            toast.success(
              result.synced > 0
                ? t('channelsPage.syncedCount', { count: result.synced })
                : t('channelsPage.syncedNone'),
            )
          })
          .catch((err) => toast.error(formatApiErrorMessage(err, t('channelsPage.couldNotSync'))))
          .finally(() => setBusy(false))
      },
      reconnect: () => setAddOpen(true),
      makePrimary: (channel) => {
        if (!token) return
        setBusy(true)
        void patchChannel(token, channel.id, { is_primary: true })
          .then(apply)
          .catch((err) => toast.error(formatApiErrorMessage(err, t('channelsPage.mailboxSaveError'))))
          .finally(() => setBusy(false))
      },
      rename: (channel) => {
        setRenameDraft(channel.displayName || channel.label || '')
        setRenameOpen(true)
      },
      archive: () => {
        setConfirmError(null)
        setConfirm('archive')
      },
      restore: (channel) => {
        if (!token) return
        setBusy(true)
        void restoreChannel(token, channel.id)
          .then((next) => {
            apply(next)
            toast.success(t('channelsPage.restored'))
          })
          .catch((err) => toast.error(formatApiErrorMessage(err, t('channelsPage.restoreError'))))
          .finally(() => setBusy(false))
      },
      deletePermanently: () => {
        setConfirmError(null)
        setDeleteDraft('')
        setConfirm('delete')
      },
      setSyncWindow: (channel, days) => {
        if (!token) return
        setBusy(true)
        void patchChannel(token, channel.id, { sync_window_days: days })
          .then(apply)
          .catch((err) => toast.error(formatApiErrorMessage(err, t('channelsPage.mailboxSaveError'))))
          .finally(() => setBusy(false))
      },
      setArchiveAutomatedMail: (channel, enabled) => {
        if (!token) return
        setBusy(true)
        void patchChannel(token, channel.id, { archive_automated_mail: enabled })
          .then(apply)
          .catch((err) => toast.error(formatApiErrorMessage(err, t('channelsPage.mailboxSaveError'))))
          .finally(() => setBusy(false))
      },
      editFolders: (channel) => {
        const target = mailboxTarget(channel)
        if (!token || !target) {
          toast.error(t('channelsPage.foldersLoadError'))
          return
        }
        setFolderTarget(target)
        setFoldersLoading(true)
        setFoldersError(null)
        void listMailboxFolders(token, target.connectionId)
          .then(setFolders)
          .catch((err) => setFoldersError(formatApiErrorMessage(err, t('channelsPage.foldersLoadError'))))
          .finally(() => setFoldersLoading(false))
      },
      editSignature: (channel) => {
        const target = mailboxTarget(channel)
        if (!token || !target) {
          toast.error(t('channelsPage.signatureLoadError'))
          return
        }
        void getConnectionSignature(token, target.connectionId)
          .then((cfg) => {
            setSignatureHtml(cfg.signatureHtml)
            setSignatureSourceState(cfg.signatureSource)
            setSignatureTarget(target)
          })
          .catch(() => toast.error(t('channelsPage.signatureLoadError')))
      },
      setSignatureSource: (channel, source) => {
        const target = mailboxTarget(channel)
        if (!token || !target) {
          toast.error(t('channelsPage.signatureSaveError'))
          return
        }
        void saveConnectionSignature(token, target.connectionId, { signatureSource: source })
          .then((cfg) => {
            setSignatureSourceState(cfg.signatureSource)
            toast.success(t('channelsPage.signatureSourceSaved'))
          })
          .catch(() => toast.error(t('channelsPage.signatureSaveError')))
      },
      aiHandlingChanged: (channel, next) => apply({ ...channel, aiHandling: next }),
      accessChanged: () => void load(),
    }),
    [token, t, apply, mailboxTarget, load],
  )

  // Deep-link from the mail composer: open the signature editor.
  useEffect(() => {
    if (!row || searchParams.get('edit') !== 'signature') return
    const target = mailboxTarget(row)
    if (!target || !token) return
    void getConnectionSignature(token, target.connectionId)
      .then((cfg) => {
        setSignatureHtml(cfg.signatureHtml)
        setSignatureSourceState(cfg.signatureSource)
        setSignatureTarget(target)
        const params = new URLSearchParams(searchParams)
        params.delete('edit')
        setSearchParams(params, { replace: true })
      })
      .catch(() => toast.error(t('channelsPage.signatureLoadError')))
  }, [row, searchParams, mailboxTarget, token, t, setSearchParams])

  const setTab = (next: WidgetTab) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'general') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  const archived = row?.state === 'archived'
  const widgetSectionValue = archived ? null : widgetSection(tab)
  const deleteConfirmText = row ? row.address || row.label : ''

  const runConfirm = () => {
    if (!token || !row || !confirm) return
    setBusy(true)
    setConfirmError(null)
    if (confirm === 'archive') {
      void archiveChannel(token, row.id)
        .then((next) => {
          apply(next)
          setConfirm(null)
          toast.success(t('channelsPage.archived'))
        })
        .catch((err) => setConfirmError(formatApiErrorMessage(err, t('channelsPage.archiveError'))))
        .finally(() => setBusy(false))
      return
    }
    void deleteChannel(token, row.id)
      .then((count) => {
        toast.success(t('channelsPage.deleted', { count }))
        navigate('/settings/channels')
      })
      .catch((err) => setConfirmError(formatApiErrorMessage(err, t('channelsPage.deleteError'))))
      .finally(() => setBusy(false))
  }

  if (loading) {
    return (
      <PageContent width="lg">
        <LoadingBlock variant="inline" label={t('channelsPage.loadingChannels')} />
      </PageContent>
    )
  }
  if (!row) {
    return (
      <PageContent width="lg" className="space-y-3">
        <p className="text-sm text-status-error">{error || t('channelsPage.notFound')}</p>
        <Link to="/settings/channels" className="text-sm font-medium text-accent hover:underline">
          {t('channelsPage.backToList')}
        </Link>
      </PageContent>
    )
  }

  return (
    <PageContent width="full" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/settings/channels"
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text-heading"
          >
            <ArrowLeft size={12} />
            {t('channelsPage.backToList')}
          </Link>
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-text-heading">{row.label}</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            {t(`channelsPage.kind.${row.kind}`, { defaultValue: row.kind })}
          </p>
        </div>
        <PageGuideLink page={row.kind === 'widget' ? 'widget' : 'channels'} compact />
      </div>

      {row.kind === 'widget' && !archived ? (
        <div className="flex flex-wrap gap-1 rounded-lg border border-border/60 p-0.5">
          {WIDGET_TABS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium',
                tab === value ? 'bg-bg-hover text-text-heading' : 'text-text-muted hover:text-text-primary',
              )}
            >
              {t(`channelsPage.widgetTabs.${value}`)}
            </button>
          ))}
        </div>
      ) : null}

      {row.kind === 'widget' && widgetSectionValue ? (
        <ChannelWidgetEditor
          channelId={row.id}
          section={widgetSectionValue}
          onSectionChange={(section) => {
            if (section === 'customization') setTab('look')
            else if (section === 'hours') setTab('hours')
            else setTab('install')
          }}
        />
      ) : (
        <ChannelPanel row={row} busy={busy} actions={actions} hideKindSettings={row.kind === 'widget'} />
      )}

      <AddChannelDialog open={addOpen} onOpenChange={setAddOpen} onChannelAdded={() => void load()} />

      <Dialog.Root open={renameOpen} onOpenChange={setRenameOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[400px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-surface p-5 shadow-overlay">
            <Dialog.Title className="mb-1 text-lg font-semibold text-text-heading">
              {t('channelsPage.renameTitle')}
            </Dialog.Title>
            <p className="mb-3 text-sm text-text-secondary">
              {t('channelsPage.renameBody', { address: row.address || row.label })}
            </p>
            <input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              className="w-full rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && token) {
                  e.preventDefault()
                  void patchChannel(token, row.id, { label: renameDraft.trim() }).then((next) => {
                    apply(next)
                    setRenameOpen(false)
                    toast.success(t('channelsPage.renameSaved'))
                  })
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRenameOpen(false)}>
                {t('channelsPage.close')}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (!token) return
                  void patchChannel(token, row.id, { label: renameDraft.trim() }).then((next) => {
                    apply(next)
                    setRenameOpen(false)
                    toast.success(t('channelsPage.renameSaved'))
                  })
                }}
              >
                {t('channelsPage.renameSave')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={confirm != null} onOpenChange={(open) => (!open ? setConfirm(null) : null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-surface p-5 shadow-overlay"
            data-testid="channel-confirm-dialog"
          >
            <Dialog.Title className="mb-2 text-lg font-semibold text-text-heading">
              {confirm === 'delete' ? t('channelsPage.deleteConfirmTitle') : t('channelsPage.archiveConfirmTitle')}
            </Dialog.Title>
            <p className="mb-4 text-sm text-text-secondary">
              {confirm === 'delete'
                ? t('channelsPage.deleteConfirmBody', {
                    name: deleteConfirmText,
                    count: row.conversationCount ?? 0,
                  })
                : t('channelsPage.archiveConfirmBody', { name: deleteConfirmText })}
            </p>
            {confirm === 'delete' ? (
              <label className="mb-4 block space-y-1.5">
                <span className="text-xs text-text-muted">
                  {t('channelsPage.deleteConfirmType', { name: deleteConfirmText })}
                </span>
                <input
                  value={deleteDraft}
                  onChange={(e) => setDeleteDraft(e.target.value)}
                  className="w-full rounded-md border border-border/60 bg-bg-elevated/60 px-2.5 py-1.5 text-sm"
                  autoComplete="off"
                  data-testid="channel-delete-confirm-input"
                />
              </label>
            ) : null}
            {confirmError ? <p className="mb-3 text-xs text-status-error">{confirmError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                {t('channelsPage.cancel')}
              </Button>
              <Button
                variant={confirm === 'delete' ? 'destructive' : 'default'}
                disabled={busy || (confirm === 'delete' && deleteDraft.trim() !== deleteConfirmText)}
                onClick={runConfirm}
              >
                {confirm === 'delete' ? t('channelsPage.delete') : t('channelsPage.archive')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={folderTarget != null} onOpenChange={(open) => (!open ? setFolderTarget(null) : null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-bg-surface p-5 shadow-overlay"
            data-testid="mailbox-folders-dialog"
          >
            <Dialog.Title className="mb-1 text-base font-semibold">{t('channelsPage.foldersTitle')}</Dialog.Title>
            {foldersError ? <p className="mb-3 text-xs text-status-error">{foldersError}</p> : null}
            {foldersLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-text-muted">
                <RefreshCw size={14} className="animate-spin" />
                {t('channelsPage.loadingFolders')}
              </div>
            ) : (
              <div className="mb-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
                {folders.map((folder) => (
                  <label key={folder.id} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 hover:bg-bg-hover">
                    <input
                      type="checkbox"
                      checked={folder.isSelected}
                      onChange={() =>
                        setFolders((prev) =>
                          prev.map((item) =>
                            item.id === folder.id ? { ...item, isSelected: !item.isSelected } : item,
                          ),
                        )
                      }
                    />
                    <span className="text-sm">{folder.displayName}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-border/60 pt-2">
              <Button variant="secondary" onClick={() => setFolderTarget(null)}>
                {t('channelsPage.cancel')}
              </Button>
              <Button
                disabled={foldersSaving || !token || !folderTarget}
                onClick={() => {
                  if (!token || !folderTarget) return
                  setFoldersSaving(true)
                  void saveMailboxFolders(
                    token,
                    folderTarget.connectionId,
                    folders.map((folder) => ({
                      id: folder.id,
                      display_name: folder.displayName,
                      is_selected: folder.isSelected,
                    })),
                  )
                    .then(() => {
                      setFolderTarget(null)
                      void load()
                    })
                    .catch((err) => setFoldersError(formatApiErrorMessage(err, t('channelsPage.foldersSaveError'))))
                    .finally(() => setFoldersSaving(false))
                }}
              >
                {t('channelsPage.save')}
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
          onSave={(signature) => {
            if (!token) return
            void saveConnectionSignature(token, signatureTarget.connectionId, {
              signatureHtml: signature,
              signatureSource,
            }).then(() => {
              setSignatureTarget(null)
              void refreshConnections()
            })
          }}
          mailboxEmail={signatureTarget.address}
        />
      ) : null}
    </PageContent>
  )
}
