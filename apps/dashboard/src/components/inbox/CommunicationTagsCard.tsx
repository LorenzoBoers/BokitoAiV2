import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useCommunicationNav } from '../../hooks/useCommunicationNav'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { folderScopeKey } from '../../lib/inbox-folder-prefs'
import { isSubQueue, SUB_QUEUES, type HubLeaf, type SubQueue } from '../../lib/messages-paths'
import { listTeams, type Team } from '../../lib/teams-api'
import { Card } from '../ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SUB_QUEUE_LABEL_KEYS } from './QueueSublist'
const USE_GLOBAL = '__global__'

/**
 * Settings card "Communication rail": which sub-view each rail row opens on
 * (global default plus per-row override for teams, hashtags and projects;
 * roams via /me/preferences). The hashtag list lives on Action tags.
 */
export default function CommunicationTagsCard() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { prefs, update } = useInboxFolderPrefs()
  const [teams, setTeams] = useState<Team[]>([])
  const [error, setError] = useState<string | null>(null)
  const { nav } = useCommunicationNav()

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

  const folderRows: Array<{ leaf: HubLeaf; label: string }> = [
    ...teams.map((team) => ({ leaf: { type: 'team', teamId: team.id } as HubLeaf, label: team.name })),
    ...[...nav.ticketTags, ...nav.tags].map((row) => ({
      leaf: { type: 'tag', tag: row.name } as HubLeaf,
      label: `#${row.name}`,
    })),
    ...nav.projects.map((row) => ({ leaf: { type: 'project', projectId: row.id } as HubLeaf, label: row.name })),
  ]

  const setGlobalDefault = useCallback(
    (queue: SubQueue) => {
      void update({ ...prefs, defaultQueue: queue }).catch(() =>
        setError(t('communicationTags.saveFailed')),
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
        setError(t('communicationTags.saveFailed')),
      )
    },
    [prefs, update, t],
  )

  return (
    <Card id="communication-tags" className="overflow-hidden p-0">
      <div className="border-b border-border/60 px-4 py-3">
        <p className="text-sm font-medium text-text-heading">{t('communicationTags.title')}</p>
        <p className="text-xs text-text-secondary">{t('communicationTags.description')}</p>
      </div>
      {error ? <p className="px-4 py-2 text-xs text-status-error">{error}</p> : null}

      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-text-heading">{t('communicationTags.defaultTitle')}</p>
            <p className="text-xs text-text-secondary">{t('communicationTags.defaultDescription')}</p>
          </div>
          <Select
            value={prefs.defaultQueue}
            onValueChange={(value) => {
              if (isSubQueue(value)) setGlobalDefault(value)
            }}
          >
            <SelectTrigger className="h-7 w-auto min-w-[8rem] text-xs" aria-label={t('communicationTags.defaultTitle')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUB_QUEUES.map((queue) => (
                <SelectItem key={queue} value={queue}>
                  {t(SUB_QUEUE_LABEL_KEYS[queue])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 space-y-1">
          {folderRows.map((row) => {
            const scopeKey = folderScopeKey(row.leaf)
            const override = prefs.channelDefaults[scopeKey] ?? ''
            return (
              <div key={scopeKey} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate-fade text-xs text-text-secondary">{row.label}</span>
                <Select
                  value={override || USE_GLOBAL}
                  onValueChange={(value) => {
                    setFolderDefault(scopeKey, isSubQueue(value) ? value : null)
                  }}
                >
                  <SelectTrigger className="h-7 w-auto min-w-[8rem] text-xs" aria-label={row.label}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={USE_GLOBAL}>
                      {t('communicationTags.useGlobal', {
                        queue: t(SUB_QUEUE_LABEL_KEYS[prefs.defaultQueue]),
                      })}
                    </SelectItem>
                    {SUB_QUEUES.map((queue) => (
                      <SelectItem key={queue} value={queue}>
                        {t(SUB_QUEUE_LABEL_KEYS[queue])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
