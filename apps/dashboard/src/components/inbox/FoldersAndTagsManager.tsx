import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { isChannelParked } from '../../lib/channel-surface'
import { folderScopeKey } from '../../lib/inbox-folder-prefs'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import { isSubQueue, SUB_QUEUES, type HubLeaf, type SubQueue } from '../../lib/messages-paths'
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
 * - Default sub-view: which queue a channel or agent folder opens on
 *   (global default + per-folder override, roams via /me/preferences).
 *
 * The former tag vocabulary was superseded by Cases: classification is
 * managed as intake types on `/cases?tab=types`.
 */
export default function FoldersAndTagsManager() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { prefs, update } = useInboxFolderPrefs()
  const { activeConnections } = useMailboxConnections()
  const [accounts, setAccounts] = useState<ChannelAccountRow[]>([])
  const [error, setError] = useState<string | null>(null)

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
    ...(!isChannelParked('slack') && enabledAccounts.some((a) => a.channel === 'slack')
      ? [
          {
            leaf: { type: 'channel', channelKey: 'slack' } as HubLeaf,
            label: t('support.channels.slack'),
          },
        ]
      : []),
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

  const selectClass =
    'h-7 rounded-md border border-border bg-bg-surface px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none'

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
        <p className="text-[13px] font-medium text-text-heading">
          {t('foldersTags.casesTitle', { defaultValue: 'Classification moved to Cases' })}
        </p>
        <p className="text-xs text-text-secondary">
          {t('foldersTags.casesDescription', {
            defaultValue:
              'Free-form tags were replaced by intake types: one catalog that agents and operators classify conversations with.',
          })}{' '}
          <Link to="/cases?tab=types" className="font-medium text-accent hover:underline">
            {t('casesPage.openCases', { defaultValue: 'Open Cases' })}
          </Link>
        </p>
      </div>
    </Card>
  )
}
