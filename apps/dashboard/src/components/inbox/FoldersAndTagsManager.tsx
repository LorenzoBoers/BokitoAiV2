import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { useSignalTags } from '../../hooks/useSignalTags'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { folderScopeKey, normalizeSidebarTag } from '../../lib/inbox-folder-prefs'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import { isSubQueue, SUB_QUEUES, type HubLeaf, type SubQueue } from '../../lib/messages-paths'
import {
  createSignalTag,
  deleteSignalTag,
  describeSignalTag,
  renameSignalTag,
  type SignalTagRow,
} from '../../lib/signals-api'
import { Button } from '../ui/button'
import { Card } from '../ui/card'

const QUEUE_LABEL_KEYS: Record<SubQueue, string> = {
  open: 'support.inbox.open',
  mine: 'support.inbox.mine',
  unassigned: 'support.inbox.unassigned',
  closed: 'support.inbox.closed',
}

/**
 * Settings card: the uniform folder system for Communication.
 *
 * - Default sub-view: which queue a channel, tag, or agent folder opens on
 *   (global default + per-folder override, roams via /me/preferences).
 * - Tags: one table for the tenant vocabulary — create, describe (the hint AI
 *   tagging reads), pin to the Communication rail, rename, or remove across
 *   every conversation.
 */
export default function FoldersAndTagsManager() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { prefs, update } = useInboxFolderPrefs()
  const { activeConnections } = useMailboxConnections()
  const { rows, reload } = useSignalTags()
  const [accounts, setAccounts] = useState<ChannelAccountRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyTag, setBusyTag] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createHint, setCreateHint] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setAccounts([])
      return
    }
    listChannelAccounts(token)
      .then((rows) => {
        if (!cancelled) setAccounts(rows)
      })
      .catch(() => {
        if (!cancelled) setAccounts([])
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const enabledAccounts = accounts.filter((a) => a.isEnabled)
  const channelRows: Array<{ leaf: HubLeaf; label: string }> = [
    ...activeConnections.map((conn) => ({
      leaf: { type: 'channel', channelKey: 'email', connectionId: String(conn.id) } as HubLeaf,
      label: mailboxDisplayLabel(conn.displayName, conn.mailboxEmail),
    })),
    ...(enabledAccounts.some((a) => a.channel === 'widget')
      ? [
          {
            leaf: { type: 'channel', channelKey: 'webchat' } as HubLeaf,
            label: t('support.channels.webchat'),
          },
        ]
      : []),
    ...(enabledAccounts.some((a) => a.channel === 'whatsapp')
      ? [
          {
            leaf: { type: 'channel', channelKey: 'whatsapp' } as HubLeaf,
            label: t('support.channels.whatsapp'),
          },
        ]
      : []),
    ...(enabledAccounts.some((a) => a.channel === 'slack')
      ? [
          {
            leaf: { type: 'channel', channelKey: 'slack' } as HubLeaf,
            label: t('support.channels.slack'),
          },
        ]
      : []),
    { leaf: { type: 'assistant' } as HubLeaf, label: t('crumbs.myAssistant') },
  ]

  const setGlobalDefault = useCallback(
    (queue: SubQueue) => {
      void update({ ...prefs, defaultQueue: queue }).catch(() =>
        setError(t('foldersTags.saveFailed')),
      )
    },
    [prefs, update, t],
  )

  const setChannelDefault = useCallback(
    (scopeKey: string, queue: SubQueue | null) => {
      const channelDefaults = { ...prefs.channelDefaults }
      if (queue) channelDefaults[scopeKey] = queue
      else delete channelDefaults[scopeKey]
      void update({ ...prefs, channelDefaults }).catch(() =>
        setError(t('foldersTags.saveFailed')),
      )
    },
    [prefs, update, t],
  )

  const setSidebarTags = useCallback(
    (sidebarTags: string[]) => {
      void update({ ...prefs, sidebarTags }).catch(() => setError(t('foldersTags.saveFailed')))
    },
    [prefs, update, t],
  )

  const toggleSidebarPin = useCallback(
    (tag: string) => {
      const key = normalizeSidebarTag(tag)
      if (!key) return
      const pinned = prefs.sidebarTags.includes(key)
      setSidebarTags(
        pinned ? prefs.sidebarTags.filter((t) => t !== key) : [...prefs.sidebarTags, key],
      )
    },
    [prefs.sidebarTags, setSidebarTags],
  )

  const handleCreate = useCallback(async () => {
    if (!token) return
    const name = normalizeSidebarTag(createName)
    if (!name) return
    setBusyTag('__new__')
    setError(null)
    try {
      await createSignalTag(token, name, createHint.trim())
      setCreateName('')
      setCreateHint('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('foldersTags.createFailed'))
    } finally {
      setBusyTag(null)
    }
  }, [token, createName, createHint, reload, t])

  const handleRename = useCallback(
    async (row: SignalTagRow) => {
      if (!token) return
      const next = window.prompt(t('foldersTags.renamePrompt', { tag: row.tag }), row.tag)
      if (next == null) return
      const newTag = normalizeSidebarTag(next)
      if (!newTag || newTag === row.tag) return
      setBusyTag(row.tag)
      setError(null)
      try {
        await renameSignalTag(token, row.tag, newTag)
        await reload()
        if (prefs.sidebarTags.includes(row.tag)) {
          setSidebarTags(prefs.sidebarTags.map((t) => (t === row.tag ? newTag : t)))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('foldersTags.renameFailed'))
      } finally {
        setBusyTag(null)
      }
    },
    [token, t, reload, prefs.sidebarTags, setSidebarTags],
  )

  const saveDescription = useCallback(
    async (row: SignalTagRow, value: string) => {
      if (!token) return
      const next = value.trim()
      if (next === (row.description ?? '').trim()) return
      setError(null)
      try {
        await describeSignalTag(token, row.tag, next)
        await reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('foldersTags.saveFailed'))
      }
    },
    [token, reload, t],
  )

  const handleDelete = useCallback(
    async (row: SignalTagRow) => {
      if (!token) return
      if (!window.confirm(t('foldersTags.deleteConfirm', { tag: row.tag, count: row.total }))) return
      setBusyTag(row.tag)
      setError(null)
      try {
        await deleteSignalTag(token, row.tag)
        await reload()
        if (prefs.sidebarTags.includes(row.tag)) {
          setSidebarTags(prefs.sidebarTags.filter((t) => t !== row.tag))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('foldersTags.deleteFailed'))
      } finally {
        setBusyTag(null)
      }
    },
    [token, t, reload, prefs.sidebarTags, setSidebarTags],
  )

  const selectClass =
    'h-7 rounded-md border border-border bg-bg-surface px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none'

  // Pinned tags that no longer exist stay listed, so a stale rail folder can
  // be unpinned from here instead of lingering forever.
  const tagRows =
    rows === null
      ? null
      : [
          ...rows,
          ...prefs.sidebarTags
            .filter((tag) => !rows.some((row) => row.tag === tag))
            .map((tag) => ({ tag, total: 0, open: 0, description: '', registered: false })),
        ]

  return (
    <Card id="tags" className="overflow-hidden p-0">
      <div className="border-b border-border/60 px-4 py-3">
        <p className="text-sm font-medium text-text-heading">{t('foldersTags.title')}</p>
        <p className="text-xs text-text-secondary">{t('foldersTags.description')}</p>
      </div>
      {error ? <p className="px-4 py-2 text-xs text-status-error">{error}</p> : null}

      <div className="border-b border-border/40 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-medium text-text-heading">{t('foldersTags.defaultTitle')}</p>
            <p className="text-xs text-text-secondary">{t('foldersTags.defaultDescription')}</p>
          </div>
          <select
            value={prefs.defaultQueue}
            onChange={(e) => {
              if (isSubQueue(e.target.value)) setGlobalDefault(e.target.value)
            }}
            className={selectClass}
            aria-label={t('foldersTags.defaultTitle')}
          >
            {SUB_QUEUES.map((queue) => (
              <option key={queue} value={queue}>
                {t(QUEUE_LABEL_KEYS[queue])}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 space-y-1">
          {channelRows.map((row) => {
            const scopeKey = folderScopeKey(row.leaf)
            const override = prefs.channelDefaults[scopeKey] ?? ''
            return (
              <div key={scopeKey} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{row.label}</span>
                <select
                  value={override}
                  onChange={(e) => {
                    const value = e.target.value
                    setChannelDefault(scopeKey, isSubQueue(value) ? value : null)
                  }}
                  className={selectClass}
                  aria-label={row.label}
                >
                  <option value="">
                    {t('foldersTags.useGlobal', { queue: t(QUEUE_LABEL_KEYS[prefs.defaultQueue]) })}
                  </option>
                  {SUB_QUEUES.map((queue) => (
                    <option key={queue} value={queue}>
                      {t(QUEUE_LABEL_KEYS[queue])}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="text-[13px] font-medium text-text-heading">{t('foldersTags.tagsTitle')}</p>
        <p className="text-xs text-text-secondary">{t('foldersTags.tagsDescription')}</p>
        <div className="mt-2 divide-y divide-border/40">
          {tagRows === null ? (
            <p className="py-2 text-xs text-text-muted">{t('foldersTags.tagsLoading')}</p>
          ) : tagRows.length === 0 ? (
            <p className="py-2 text-xs text-text-muted">{t('foldersTags.tagsEmpty')}</p>
          ) : (
            tagRows.map((row) => {
              const pinned = prefs.sidebarTags.includes(row.tag)
              return (
                <div key={row.tag} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-heading">
                    {row.tag}
                  </span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {t('foldersTags.tagUsage', { count: row.total, open: row.open })}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant={pinned ? 'secondary' : 'ghost'}
                      aria-label={
                        pinned
                          ? t('foldersTags.unpinAria', { tag: row.tag })
                          : t('foldersTags.pinAria', { tag: row.tag })
                      }
                      aria-pressed={pinned}
                      onClick={() => toggleSidebarPin(row.tag)}
                    >
                      {pinned ? <Pin size={13} /> : <PinOff size={13} />}
                      <span className="ml-1 text-xs">
                        {pinned ? t('foldersTags.pinned') : t('foldersTags.pin')}
                      </span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('foldersTags.renameAria')}
                      disabled={busyTag === row.tag}
                      onClick={() => void handleRename(row)}
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('foldersTags.deleteAria')}
                      disabled={busyTag === row.tag}
                      onClick={() => void handleDelete(row)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                  <input
                    defaultValue={row.description}
                    key={`${row.tag}:${row.description}`}
                    onBlur={(e) => void saveDescription(row, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    placeholder={t('foldersTags.tagHintPlaceholder')}
                    aria-label={t('foldersTags.tagHintAria', { tag: row.tag })}
                    className="h-7 w-full rounded-md border border-border/60 bg-bg-surface px-2 text-xs text-text-secondary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
                  />
                </div>
              )
            })
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
          <input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleCreate()
              }
            }}
            placeholder={t('foldersTags.tagNamePlaceholder')}
            aria-label={t('foldersTags.tagNamePlaceholder')}
            className="h-8 w-40 rounded-md border border-border bg-bg-surface px-2.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
          />
          <input
            value={createHint}
            onChange={(e) => setCreateHint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleCreate()
              }
            }}
            placeholder={t('foldersTags.tagHintPlaceholder')}
            aria-label={t('foldersTags.tagHintPlaceholder')}
            className="h-8 min-w-[12rem] flex-1 rounded-md border border-border bg-bg-surface px-2.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleCreate()}
            disabled={!createName.trim() || busyTag === '__new__'}
          >
            {t('foldersTags.tagAdd')}
          </Button>
        </div>
      </div>
    </Card>
  )
}
