import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { TagPill } from '../ui/TagPill'
import { TagSetPicker } from '../ui/TagSetPicker'
import { notifyFoldersChanged } from '../../lib/folders-bus'
import { patchProject } from '../../lib/projects-api'
import { cn } from '../../lib/utils'

/**
 * Folder header: display name + optional AND labels.
 * Admins edit the name inline and labels via TagSetPicker.
 */
export function FiltersetHeading({
  folderId,
  name,
  tagNames,
  canEdit,
  onChanged,
  size = 'lg',
  className,
}: {
  folderId: string
  name: string
  tagNames: string[]
  canEdit: boolean
  onChanged?: () => Promise<void> | void
  size?: 'md' | 'lg'
  className?: string
}) {
  const { t } = useTranslation('nav')
  const [open, setOpen] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [savingName, setSavingName] = useState(false)
  const names = tagNames.map((n) => n.replace(/^#/, '')).filter(Boolean)
  const titleClass = size === 'lg' ? 'text-lg font-semibold' : 'text-sm font-medium'
  const displayName = (name || '').replace(/^#/, '').trim() || 'Folder'

  const saveName = async () => {
    const next = draftName.trim()
    if (!next || next === displayName) {
      setDraftName(displayName)
      return
    }
    setSavingName(true)
    try {
      await patchProject(folderId, { name: next })
      toast.success(t('projects.detail.saved', { defaultValue: 'Folder saved' }))
      notifyFoldersChanged({ folderId })
      await onChanged?.()
    } catch (err) {
      setDraftName(displayName)
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
    } finally {
      setSavingName(false)
    }
  }

  return (
    <>
      <div className={cn('group/title flex min-w-0 flex-col gap-1.5', className)}>
        <div className={cn('flex min-w-0 items-center gap-2.5', titleClass)}>
          <FolderOpen size={size === 'lg' ? 24 : 18} className="shrink-0 text-text-muted" aria-hidden />
          {canEdit ? (
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
                if (event.key === 'Escape') {
                  setDraftName(displayName)
                  event.currentTarget.blur()
                }
              }}
              disabled={savingName}
              aria-label={t('projects.page.name')}
              className="min-w-0 flex-1 truncate bg-transparent text-inherit outline-none ring-offset-2 ring-offset-bg-surface focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          ) : (
            <span className="min-w-0 truncate text-text-heading">{displayName}</span>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pl-8">
          {names.map((tag) => (
            <TagPill key={tag} names={tag} tone="free" size="md" />
          ))}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-hover/70 hover:text-text-heading"
              aria-label={t('projects.detail.editFilterset', { defaultValue: 'Edit labels' })}
            >
              <Pencil size={12} aria-hidden />
              {names.length
                ? t('projects.detail.editLabels', { defaultValue: 'Edit labels' })
                : t('projects.detail.addTags', { defaultValue: 'Add labels' })}
            </button>
          ) : null}
        </div>
      </div>
      <TagSetPicker
        open={open}
        onOpenChange={setOpen}
        mode="folder"
        title={t('projects.detail.editFiltersetTitle', { defaultValue: 'Edit folder labels' })}
        description={t('projects.detail.editFiltersetBody', {
          defaultValue: 'Pick every label this folder should require. Nesting is separate.',
        })}
        confirmLabel={t('projects.detail.saveFilterset', { defaultValue: 'Save labels' })}
        initialSelected={names}
        onConfirm={async (next) => {
          try {
            await patchProject(folderId, { tags: next })
            toast.success(t('projects.detail.filtersetSaved', { defaultValue: 'Labels updated' }))
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
