import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import type { InboxThread, PatchThreadInput } from '../../lib/inbox-api'
import { openEntityPath } from '../../lib/open-entity'
import { Hashtag } from '../ui/HashtagMark'
import { HashtagPickerModal } from './HashtagPickerModal'

type Props = {
  thread: InboxThread
  saving?: boolean
  onPatch?: (input: PatchThreadInput) => Promise<void>
  onTicketChanged?: () => void
}

const CHIP =
  'inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border/70 px-2 text-xs text-text-heading'
const CHIP_LINK = 'min-w-0 truncate rounded-sm hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60'

/**
 * Hashtag chips on the conversation. The accent chip is the filed action tag
 * (locked; change via replace/split in the picker). Free hashtags and new
 * action tags go through HashtagPickerModal. Every chip opens its folder in
 * Communication, like the same `#tag` inside a chat message.
 */
export function ThreadTags({ thread, saving = false, onPatch, onTicketChanged }: Props) {
  const { t } = useTranslation('communication')
  const [open, setOpen] = useState(false)
  const tags = thread.tags ?? []
  const inherited = thread.inheritedTags ?? []
  const actionTag = thread.ticket && thread.ticket.status !== 'proposed' ? thread.ticket : null

  const save = (next: string[]) => (onPatch ? onPatch({ tags: next }) : Promise.resolve())

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        {actionTag ? (
          <span className={`${CHIP} bg-bg-subtle/60`} title={t('tags.categoryLocked')}>
            <Link
              to={openEntityPath({ type: 'tag', name: actionTag.name })}
              className={CHIP_LINK}
              title={t('tags.openFolder', { tag: actionTag.name })}
            >
              <Hashtag name={actionTag.name} category />
            </Link>
          </span>
        ) : null}
        {tags.map((tag) => (
          <span key={tag} className={CHIP}>
            <Link
              to={openEntityPath({ type: 'tag', name: tag })}
              className={CHIP_LINK}
              title={t('tags.openFolder', { tag })}
            >
              <Hashtag name={tag} />
            </Link>
            {onPatch ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void save(tags.filter((other) => other !== tag))}
                aria-label={t('tags.remove', { tag })}
                className="-mr-0.5 rounded text-text-muted hover:text-text-primary disabled:opacity-40"
              >
                <X size={11} />
              </button>
            ) : null}
          </span>
        ))}
        {inherited.map((tag) => (
          <span
            key={`via-${tag}`}
            className={`${CHIP} border-dashed text-text-muted`}
            title={t('tags.viaContact', { defaultValue: 'Via contact' })}
          >
            <Link
              to={openEntityPath({ type: 'tag', name: tag })}
              className={CHIP_LINK}
              title={t('tags.openFolder', { tag })}
            >
              <Hashtag name={tag} />
            </Link>
            <span className="text-2xs">{t('tags.viaContact', { defaultValue: 'via contact' })}</span>
          </span>
        ))}
        {onPatch ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => setOpen(true)}
            aria-label={t('tags.add')}
            title={t('tags.add')}
            className={`${CHIP} px-1.5 text-text-secondary transition-colors hover:bg-bg-hover/70 disabled:opacity-40`}
          >
            <Plus size={12} />
          </button>
        ) : null}
      </div>
      <HashtagPickerModal
        open={open}
        onOpenChange={setOpen}
        thread={thread}
        onPatch={onPatch}
        onTicketChanged={onTicketChanged}
      />
    </>
  )
}
