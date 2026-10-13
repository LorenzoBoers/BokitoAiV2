import { FolderOpen, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { HashtagSet } from '../ui/HashtagMark'

/**
 * The map *is* its tags. Typographic `#a · #b` title; admins click to edit.
 */
export function FolderTitleTags({
  tagNames,
  canEdit = false,
  onEdit,
  size = 'md',
  className,
}: {
  tagNames: string[]
  canEdit?: boolean
  onEdit?: () => void
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const { t } = useTranslation('nav')
  const names = tagNames.map((n) => n.replace(/^#/, '')).filter(Boolean)
  if (!names.length) {
    return (
      <button
        type="button"
        disabled={!canEdit || !onEdit}
        onClick={onEdit}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-text-muted transition-colors',
          canEdit && 'hover:border-accent/40 hover:text-text-secondary',
          className,
        )}
      >
        {t('projects.detail.addTagsTitle', { defaultValue: 'Add tags to define this map' })}
      </button>
    )
  }

  const titleClass = size === 'lg' ? 'text-lg font-semibold' : size === 'sm' ? 'text-xs' : 'text-sm font-medium'
  const iconSize = size === 'lg' ? 24 : size === 'sm' ? 16 : 18
  const body = (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-2', titleClass)}>
      <FolderOpen size={iconSize} className="shrink-0 text-text-muted" aria-hidden />
      <HashtagSet names={names} />
      {canEdit ? (
        <span
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors',
            'group-hover/title:text-accent',
          )}
          aria-hidden
        >
          <Pencil size={13} />
        </span>
      ) : null}
    </span>
  )

  if (!canEdit || !onEdit) {
    return <div className={cn('min-w-0', className)}>{body}</div>
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        'group/title -ml-1 inline-flex max-w-full min-w-0 rounded-xl p-1 text-left transition-colors hover:bg-white/[0.03]',
        className,
      )}
      aria-label={t('projects.detail.editFilterset', { defaultValue: 'Edit tags' })}
      title={t('projects.detail.editFilterset', { defaultValue: 'Edit tags' })}
    >
      {body}
    </button>
  )
}
