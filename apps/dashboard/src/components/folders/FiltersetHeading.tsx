import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { HashtagSet } from '../ui/HashtagMark'
import { TagSetPicker } from '../ui/TagSetPicker'
import { notifyFoldersChanged } from '../../lib/folders-bus'
import { patchProject } from '../../lib/projects-api'
import { cn } from '../../lib/utils'

/**
 * Folder title = its tags as typographic `#a · #b`. Admins click to edit via TagSetPicker.
 * When a derived parent exists, broader tags stay locked; only local tags are editable.
 */
export function FiltersetHeading({
  folderId,
  tagNames,
  parentTagNames,
  canEdit,
  onChanged,
  size = 'lg',
  className,
}: {
  folderId: string
  tagNames: string[]
  /** Derived broader map tags — locked in the editor. */
  parentTagNames?: string[] | null
  canEdit: boolean
  onChanged?: () => Promise<void> | void
  size?: 'md' | 'lg'
  className?: string
}) {
  const { t } = useTranslation('nav')
  const [open, setOpen] = useState(false)
  const names = tagNames.map((n) => n.replace(/^#/, '')).filter(Boolean)
  const locked = (parentTagNames ?? []).map((n) => n.replace(/^#/, '')).filter(Boolean)
  const titleClass = size === 'lg' ? 'text-lg font-semibold' : 'text-sm font-medium'

  if (!names.length) {
    return canEdit ? (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-text-muted transition-colors hover:border-accent/40 hover:text-text-heading',
            className,
          )}
        >
          {t('projects.detail.addTags', { defaultValue: 'Add tags to define this map' })}
        </button>
        <TagSetPicker
          open={open}
          onOpenChange={setOpen}
          mode="folder"
          title={t('projects.detail.editFiltersetTitle', { defaultValue: 'Edit folder tags' })}
          description={t('projects.detail.editFiltersetBody', {
            defaultValue: 'Pick every tag this map should require.',
          })}
          confirmLabel={t('projects.detail.saveFilterset', { defaultValue: 'Save tags' })}
          lockedNames={locked}
          initialSelected={[]}
          showParentPreview
          onConfirm={async (next) => {
            await patchProject(folderId, { tags: next })
            toast.success(t('projects.detail.filtersetSaved', { defaultValue: 'Filterset updated' }))
            notifyFoldersChanged({ folderId })
            await onChanged?.()
          }}
        />
      </>
    ) : (
      <span className="text-sm text-text-muted">{t('projects.detail.filtersetEmpty')}</span>
    )
  }

  const label = (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-2.5', titleClass)}>
      <FolderOpen size={size === 'lg' ? 24 : 18} className="shrink-0 text-text-muted" aria-hidden />
      <HashtagSet names={names} />
    </span>
  )

  return (
    <>
      <div className={cn('group/title flex min-w-0 flex-wrap items-center gap-1.5', className)}>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg text-left text-text-heading outline-none ring-offset-2 ring-offset-bg-surface focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={t('projects.detail.editFilterset', { defaultValue: 'Edit tags' })}
            title={t('projects.detail.editFilterset', { defaultValue: 'Edit tags' })}
          >
            {label}
            <span className="ml-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-within/title:opacity-100">
              <Pencil size={14} aria-hidden />
            </span>
          </button>
        ) : (
          label
        )}
      </div>
      <TagSetPicker
        open={open}
        onOpenChange={setOpen}
        mode="folder"
        title={t('projects.detail.editFiltersetTitle', { defaultValue: 'Edit folder tags' })}
        description={
          locked.length
            ? t('projects.detail.editFiltersetBodyNested', {
                defaultValue:
                  'Tags from the broader map stay required. Add or remove only the extra tags for this map.',
              })
            : t('projects.detail.editFiltersetBody', {
                defaultValue: 'Pick every tag this map should require.',
              })
        }
        confirmLabel={t('projects.detail.saveFilterset', { defaultValue: 'Save tags' })}
        lockedNames={locked}
        initialSelected={names}
        showParentPreview={!locked.length}
        onConfirm={async (next) => {
          try {
            await patchProject(folderId, { tags: next })
            toast.success(t('projects.detail.filtersetSaved', { defaultValue: 'Filterset updated' }))
            notifyFoldersChanged({ folderId })
            await onChanged?.()
          } catch (err) {
            toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
            throw err
          }
        }}
      />
    </>
  )
}
