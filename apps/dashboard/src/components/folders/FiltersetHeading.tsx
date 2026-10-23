import { useState } from 'react'
import { Button } from '../ui/button'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { NameEdit } from '../ui/NameEdit'
import { TagPill } from '../ui/TagPill'
import { TagSetPicker } from '../ui/TagSetPicker'
import { notifyFoldersChanged } from '../../lib/folders-bus'
import { patchProject } from '../../lib/projects-api'
import { cn } from '../../lib/utils'

/**
 * Folder header: display name + optional AND labels in one chip field.
 * Admins open TagSetPicker from + (or the field) to add or change labels.
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
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [savingName, setSavingName] = useState(false)
  const [savingTags, setSavingTags] = useState(false)
  const names = tagNames.map((n) => n.replace(/^#/, '')).filter(Boolean)
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

  const saveTags = async (next: string[]) => {
    setSavingTags(true)
    try {
      await patchProject(folderId, { tags: next })
      toast.success(t('projects.detail.filtersetSaved', { defaultValue: 'Labels updated' }))
      notifyFoldersChanged({ folderId })
      await onChanged?.()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.saveError')))
      throw err
    } finally {
      setSavingTags(false)
    }
  }

  const removeTag = (tag: string) => {
    void saveTags(names.filter((name) => name !== tag)).catch(() => undefined)
  }

  const labelsAria = t('projects.detail.labelsField', { defaultValue: 'Folder labels' })
  const addAria = t('projects.detail.addTags', { defaultValue: 'Add labels' })

  return (
    <>
      <div className={cn('group/title flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5', className)}>
        <div className="flex min-w-0 items-center gap-2.5">
          <FolderOpen size={size === 'lg' ? 24 : 18} className="shrink-0 text-text-muted" aria-hidden />
          <NameEdit
            value={editingName ? draftName : displayName}
            canEdit={canEdit}
            editing={editingName}
            disabled={savingName}
            heading="span"
            size="lg"
            label={t('projects.detail.renameFolder', { defaultValue: 'Rename folder' })}
            onStart={() => {
              setDraftName(displayName)
              setEditingName(true)
            }}
            onChange={setDraftName}
            onCommit={() => {
              setEditingName(false)
              void saveName()
            }}
            onCancel={() => {
              setDraftName(displayName)
              setEditingName(false)
            }}
          />
        </div>
        {canEdit || names.length > 0 ? (
          <div
            role="group"
            aria-label={labelsAria}
            className={cn(
              'flex min-h-9 min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-border bg-bg-input px-2 py-1',
              canEdit && 'cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-border focus-within:border-accent/50',
            )}
            onClick={
              canEdit
                ? (event) => {
                    if ((event.target as HTMLElement).closest('button')) return
                    setOpen(true)
                  }
                : undefined
            }
          >
            {names.map((tag) => (
              <TagPill
                key={tag}
                names={tag}
                tone="free"
                size="md"
                disabled={savingTags}
                removeAlwaysVisible={canEdit}
                onRemove={canEdit ? () => removeTag(tag) : undefined}
                removeLabel={tag}
              />
            ))}
            {canEdit ? (
              <Button variant="ghost" size="iconSm"
                type="button"
                onClick={() => setOpen(true)}
                disabled={savingTags}
                className="shrink-0"
                aria-label={addAria}
                title={addAria}
              >
                <Plus size={14} aria-hidden />
              </Button>
            ) : null}
            {canEdit && names.length === 0 ? (
              <span className="px-0.5 text-xs text-text-muted">{addAria}</span>
            ) : null}
          </div>
        ) : null}
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
        onConfirm={saveTags}
      />
    </>
  )
}
