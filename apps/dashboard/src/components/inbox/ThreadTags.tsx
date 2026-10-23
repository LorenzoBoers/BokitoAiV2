import { useState, type ReactNode } from 'react'
import { Button } from '../ui/button'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { InboxThread, PatchThreadInput } from '../../lib/inbox-api'
import { filtersetLabel } from '../../lib/folder-filter-tree'
import { openEntityPath } from '../../lib/open-entity'
import type { LabelColor } from '../../lib/signals-api'
import { clearTicket } from '../../lib/tickets-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useConfirm } from '../ui/confirm-dialog'
import { TagPill } from '../ui/TagPill'
import { HashtagPickerModal } from './HashtagPickerModal'

type Props = {
  thread: InboxThread
  saving?: boolean
  onPatch?: (input: PatchThreadInput) => Promise<boolean | void>
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
  const confirm = useConfirm()
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

  const dropActionTag = async () => {
    if (!actionTag) return
    const name = actionTag.name
    const ok = await confirm({
      title: t('tags.unlinkActionTitle'),
      description: (
        <span className="flex flex-col items-start gap-3">
          <span>{t('tags.unlinkActionBody')}</span>
          <TagPill
            names={name}
            tone="action"
            size="md"
            color={(actionTag.color || '') as LabelColor}
            icon={actionTag.icon}
          />
        </span>
      ),
      confirmLabel: t('tags.unlinkActionConfirmLabel'),
      destructive: true,
    })
    if (!ok) return
    try {
      await clearTicket(String(thread.id))
      if (tags.includes(name)) await save(tags.filter((other) => other !== name))
      onTicketChanged?.()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('tags.unlinkActionFailed')))
    }
  }

  type Slot = { key: string; node: ReactNode }
  const slots: Slot[] = []

  if (actionTag) {
    slots.push({
      key: `action-${actionTag.name}`,
      node: (
        <span className="inline-flex">
          <TagPill
            names={actionTag.name}
            tone="action"
            size="sm"
            color={(actionTag.color || '') as LabelColor}
            icon={actionTag.icon}
            disabled={saving}
            title={t('tags.unlinkAction', { tag: actionTag.name })}
            removeLabel={t('tags.unlinkAction', { tag: actionTag.name })}
            onClick={() => navigate(openEntityPath({ type: 'tag', name: actionTag.name }))}
            onRemove={onPatch ? () => void dropActionTag() : undefined}
          />
        </span>
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
          className="inline-flex items-center no-underline"
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
          className="inline-flex items-center no-underline"
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
      <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-1.5">
        {visible.map((slot) => (
          <span key={slot.key} className="inline-flex items-center">{slot.node}</span>
        ))}
        {hiddenCount > 0 ? (
          <Button variant="ghost" size="xs"
            type="button"
            disabled={saving}
            onClick={() => setExpanded(true)}
          >
            {t('tags.moreCount', { count: hiddenCount })}
          </Button>
        ) : null}
        {onPatch ? (
          <Button variant="ghost" size="iconSm"
            type="button"
            disabled={saving}
            onClick={() => setOpen(true)}
            aria-label={t('tags.add')}
            title={t('tags.add')}
          >
            <Plus size={14} />
          </Button>
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
