import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { InboxThread, PatchThreadInput } from '../../lib/inbox-api'
import { filtersetLabel } from '../../lib/folder-filter-tree'
import { openEntityPath } from '../../lib/open-entity'
import { TagPill } from '../ui/TagPill'
import { HashtagPickerModal } from './HashtagPickerModal'

type Props = {
  thread: InboxThread
  saving?: boolean
  onPatch?: (input: PatchThreadInput) => Promise<void>
  onTicketChanged?: () => void
}

/**
 * Hashtag chips on the conversation. Shared TagPill everywhere; add opens
 * multi-select TagSetPicker via HashtagPickerModal.
 */
export function ThreadTags({ thread, saving = false, onPatch, onTicketChanged }: Props) {
  const { t } = useTranslation('communication')
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const tags = thread.tags ?? []
  const inherited = thread.inheritedTags ?? []
  const folderPaths = thread.folderPaths ?? []
  const pathTags = new Set(folderPaths.flatMap((path) => path.tags))
  const freeTags = tags.filter((tag) => !pathTags.has(tag))
  const inheritedRest = inherited.filter((tag) => !pathTags.has(tag))
  const actionTag = thread.ticket && thread.ticket.status !== 'proposed' ? thread.ticket : null

  const save = (next: string[]) => (onPatch ? onPatch({ tags: next }) : Promise.resolve())

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        {actionTag ? (
          <Link
            to={openEntityPath({ type: 'tag', name: actionTag.name })}
            title={t('tags.categoryLocked')}
            className="no-underline"
          >
            <TagPill names={actionTag.name} tone="action" />
          </Link>
        ) : null}
        {folderPaths.map((path) => (
          <Link
            key={path.tags.join('/')}
            to={
              path.projectId
                ? openEntityPath({ type: 'folder', id: path.projectId })
                : openEntityPath({ type: 'tag', name: path.tags[path.tags.length - 1] ?? '' })
            }
            title={filtersetLabel(path.tags)}
            className="no-underline"
          >
            <TagPill names={path.tags} tone="set" />
          </Link>
        ))}
        {freeTags.map((tag) => (
          <TagPill
            key={tag}
            names={tag}
            onRemove={onPatch ? () => void save(tags.filter((other) => other !== tag)) : undefined}
            removeLabel={t('tags.remove', { tag })}
            disabled={saving}
            title={t('tags.openFolder', { tag })}
            onClick={() => navigate(openEntityPath({ type: 'tag', name: tag }))}
          />
        ))}
        {inheritedRest.map((tag) => (
          <Link
            key={`via-${tag}`}
            to={openEntityPath({ type: 'tag', name: tag })}
            title={t('tags.viaContact')}
            className="no-underline"
          >
            <TagPill names={tag} tone="inherited" />
          </Link>
        ))}
        {onPatch ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => setOpen(true)}
            aria-label={t('tags.add')}
            title={t('tags.add')}
            className="tag-pill inline-flex h-7 items-center justify-center rounded-lg border border-white/[0.07] bg-gradient-to-b from-white/[0.07] to-white/[0.02] px-1.5 text-text-secondary transition-colors hover:border-white/12 hover:from-white/[0.1] disabled:opacity-40"
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
