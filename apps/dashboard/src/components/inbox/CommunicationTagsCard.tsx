import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { INBOX_WORK_QUEUES, isSubQueue, type SubQueue } from '../../lib/messages-paths'
import { Card } from '../ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SUB_QUEUE_LABEL_KEYS } from './QueueSublist'
/**
 * Which list All communication opens on. Other rail rows open their own list.
 */
export default function CommunicationTagsCard() {
  const { t } = useTranslation('nav')
  const { prefs, update } = useInboxFolderPrefs()
  const [error, setError] = useState<string | null>(null)

  const setGlobalDefault = useCallback(
    (queue: SubQueue) => {
      void update({ ...prefs, defaultQueue: queue }).catch(() =>
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
            value={(INBOX_WORK_QUEUES as readonly string[]).includes(prefs.defaultQueue) ? prefs.defaultQueue : 'for_you'}
            onValueChange={(value) => {
              if (isSubQueue(value)) setGlobalDefault(value)
            }}
          >
            <SelectTrigger className="h-7 w-auto min-w-[8rem] text-xs" aria-label={t('communicationTags.defaultTitle')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INBOX_WORK_QUEUES.map((queue) => (
                <SelectItem key={queue} value={queue}>
                  {t(SUB_QUEUE_LABEL_KEYS[queue])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  )
}
