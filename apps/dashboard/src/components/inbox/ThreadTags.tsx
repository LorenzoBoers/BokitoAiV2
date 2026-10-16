import { useState, type ReactNode } from 'react'
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

const VISIBLE_CAP = 4

/**
 * Hashtag chips on the conversation. Shared TagPill everywhere; add opens
 * multi-select TagSetPicker via HashtagPickerModal. Caps visible pills so the
 * side panel stays calm when a thread has many labels.
 */
export function ThreadTags({ thread, saving = false, onPatch, onTicketChanged }: Props) {
  const { t } = useTranslation('communication')
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const tags = thread.tags ?? []
  const inherited = thread.inheritedTags ?? []
  const folderPaths = thread.folderPaths ?? []
  const pathTags = new Set(folderPaths.flatMap((path) => path.tags))
  const freeTags = tags.filter((tag) => !pathTags.has(tag))
  const inheritedRest = inherited.filter((tag) => !pathTags.has(tag))
  const actionTag = thread.ticket && thread.ticket.status !== 'proposed' ? thread.ticket : null

  const save = (next: string[]) => (onPatch ? onPatch({ tags: next }) : Promise.resolve())

  type Slot = { key: string; node: ReactNode }
  const slots: Slot[] = []

  if (actionTag) {
    slots.push({
      key: `action-${actionTag.name}`,
      node: (
        <Link
          to={openEntityPath({ type: 'tag', name: actionTag.name })}
          title={t('tags.categoryLocked')}
          className="no-underline"
        >
          <TagPill names={actionTag.name} tone="action" size="sm" />
        </Link>
      ),
    })
  }
  for (const path of folderPaths) {
    slots.push({
      key: `path-${path.tags.join('/')}`,
      node: (
        <Link
          to={
            path.projectId
              ? openEntityPath({ type: 'folder', id: path.projectId })
              : openEntityPath({ type: 'tag', name: path.tags[path.tags.length - 1] ?? '' })
          }
          title={filtersetLabel(path.tags)}
          className="no-underline"
        >
          <TagPill names={path.tags} tone="set" size="sm" />
        </Link>
      ),
    })
  }
  for (const tag of freeTags) {
    slots.push({
      key: `free-${tag}`,
      node: (
        <TagPill
          names={tag}
          size="sm"
          onRemove={onPatch ? () => void save(tags.filter((other) => other !== tag)) : undefined}
          removeLabel={t('tags.remove', { tag })}
          disabled={saving}
          title={t('tags.openFolder', { tag })}
          onClick={() => navigate(openEntityPath({ type: 'tag', name: tag }))}
        />
      ),
    })
  }
  for (const tag of inheritedRest) {
    slots.push({
      key: `via-${tag}`,
      node: (
        <Link
          to={openEntityPath({ type: 'tag', name: tag })}
          title={t('tags.viaContact')}
          className="no-underline"
        >
          <TagPill names={tag} tone="inherited" size="sm" />
        </Link>
      ),
    })
  }

  const visible = expanded ? slots : slots.slice(0, VISIBLE_CAP)
  const hiddenCount = expanded ? 0 : Math.max(0, slots.length - VISIBLE_CAP)

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5">
        {visible.map((slot) => (
          <span key={slot.key}>{slot.node}</span>
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => setExpanded(true)}
            className="inline-flex h-5 items-center rounded-full bg-bg-hover px-2 text-2xs font-medium text-text-muted transition-colors hover:bg-border-light/35 hover:text-text-heading disabled:opacity-40"
          >
            {t('tags.moreCount', { count: hiddenCount })}
          </button>
        ) : null}
        {onPatch ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => setOpen(true)}
            aria-label={t('tags.add')}
            title={t('tags.add')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-secondary ring-1 ring-inset ring-border/50 transition-colors hover:bg-bg-elevated hover:text-text-heading disabled:opacity-40"
          >
            <Plus size={11} />
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
