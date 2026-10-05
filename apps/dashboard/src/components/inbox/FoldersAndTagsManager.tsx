import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { folderScopeKey } from '../../lib/inbox-folder-prefs'
import { isSubQueue, SUB_QUEUES, type HubLeaf, type SubQueue } from '../../lib/messages-paths'
import { listTeams, type Team } from '../../lib/teams-api'
import { Card } from '../ui/card'
import { SUB_QUEUE_LABEL_KEYS } from './QueueSublist'
import { SavedFoldersSection } from './SavedFoldersSection'
import { TagRegistrySection } from './TagRegistrySection'

/**
 * Settings card: the uniform folder system for Communication.
 *
 * - Default sub-view: which queue All communication and each pinned team open
 *   on (global default + per-team override, roams via /me/preferences).
 * - Folders: saved filters shown under Folders in the sidebar.
 * - Tags: the workspace tag list (TagRegistrySection).
 */
export default function FoldersAndTagsManager() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { prefs, update } = useInboxFolderPrefs()
  const [teams, setTeams] = useState<Team[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setTeams([])
      return
    }
    listTeams(token)
      .then((rows) => {
        if (!cancelled) setTeams(rows.filter((team) => team.pinned))
      })
      .catch(() => {
        if (!cancelled) setTeams([])
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const folderRows: Array<{ leaf: HubLeaf; label: string }> = teams.map((team) => ({
    leaf: { type: 'team', teamId: team.id },
    label: team.name,
  }))

  const setGlobalDefault = useCallback(
    (queue: SubQueue) => {
      void update({ ...prefs, defaultQueue: queue }).catch(() =>
        setError(t('foldersTags.saveFailed')),
      )
    },
    [prefs, update, t],
  )

  const setFolderDefault = useCallback(
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
    <Card id="folders" className="overflow-hidden p-0">
      <div className="border-b border-border/60 px-4 py-3">
        <p className="text-sm font-medium text-text-heading">{t('foldersTags.title')}</p>
        <p className="text-xs text-text-secondary">{t('foldersTags.description')}</p>
      </div>
      {error ? <p className="px-4 py-2 text-xs text-status-error">{error}</p> : null}

      <div className="border-b border-border/40 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-text-heading">{t('foldersTags.defaultTitle')}</p>
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
                {t(SUB_QUEUE_LABEL_KEYS[queue])}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 space-y-1">
          {folderRows.map((row) => {
            const scopeKey = folderScopeKey(row.leaf)
            const override = prefs.channelDefaults[scopeKey] ?? ''
            return (
              <div key={scopeKey} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate-fade text-xs text-text-secondary">{row.label}</span>
                <select
                  value={override}
                  onChange={(e) => {
                    const value = e.target.value
                    setFolderDefault(scopeKey, isSubQueue(value) ? value : null)
                  }}
                  className={selectClass}
                  aria-label={row.label}
                >
                  <option value="">
                    {t('foldersTags.useGlobal', { queue: t(SUB_QUEUE_LABEL_KEYS[prefs.defaultQueue]) })}
                  </option>
                  {SUB_QUEUES.map((queue) => (
                    <option key={queue} value={queue}>
                      {t(SUB_QUEUE_LABEL_KEYS[queue])}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      </div>

      <SavedFoldersSection />
      <TagRegistrySection />
    </Card>
  )
}
