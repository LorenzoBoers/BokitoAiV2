import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { openEntityPath } from '../../lib/open-entity'
import { useEntityRefresh } from '../../lib/live-store'
import { normalizeHashtag, stripHash } from '../../lib/hashtag'
import {
  LABEL_COLORS,
  createSignalTag,
  createTagGroup,
  deleteSignalTag,
  deleteTagGroup,
  listSignalTags,
  listTagGroups,
  updateSignalTag,
  updateTagGroup,
  type LabelColor,
  type SignalTag,
  type TagGroup,
} from '../../lib/signals-api'
import { createProject } from '../../lib/projects-api'
import { patchCategory, promoteTag } from '../../lib/tickets-api'
import { listWorkstreams, type WorkstreamRow } from '../../lib/workstreams-api'
import { workstreamPath } from '../../lib/workstream-ui'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { useConfirm } from '../ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { EntityRow } from '../ui/entity-row'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { Switch } from '../ui/switch'
import { TagPill } from '../ui/TagPill'
import { cn } from '../../lib/utils'

type EditDraft = {
  name: string
  description: string
  color: LabelColor
  groupId: string | null
  showInNav: boolean
  aiAutoTag: boolean
  alwaysReview: boolean
}

const NEW_PLAYBOOK = '__new__'
const Workflow = ENTITY_ICONS.flow
const FolderIcon = ENTITY_ICONS.folder

const COLOR_SWATCH: Record<Exclude<LabelColor, ''>, string> = {
  neutral: 'bg-text-muted',
  accent: 'bg-accent',
  ai: 'bg-ai',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  info: 'bg-status-info',
}

function emptyDraft(): EditDraft {
  return {
    name: '',
    description: '',
    color: '',
    groupId: null,
    showInNav: false,
    aiAutoTag: true,
    alwaysReview: false,
  }
}

function draftFromTag(tag: SignalTag): EditDraft {
  return {
    name: tag.name,
    description: tag.description,
    color: tag.color,
    groupId: tag.groupId,
    showInNav: tag.showInNav,
    aiAutoTag: tag.aiAutoTag,
    alwaysReview: tag.isCategory && tag.sendMode !== 'send',
  }
}

/**
 * Workspace labels in one list. Action tags first (flow badge), then free labels.
 * Create and edit open a modal; the list stays scannable.
 */
export function TagRegistrySection({
  freeOnly = false,
  onChanged,
}: {
  /** Hide action tags, for pages that already list them. */
  freeOnly?: boolean
  onChanged?: () => void
} = {}) {
  const { t } = useTranslation('nav')
  const confirm = useConfirm()
  const { token } = useAuth()
  const [allTags, setTags] = useState<SignalTag[]>([])
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupExclusive, setGroupExclusive] = useState(false)
  const [folderFor, setFolderFor] = useState<SignalTag | null>(null)
  const [editing, setEditing] = useState<SignalTag | 'new' | null>(null)
  const [draft, setDraft] = useState<EditDraft>(emptyDraft)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [promoting, setPromoting] = useState<SignalTag | null>(null)

  const tags = useMemo(() => {
    const rows = freeOnly ? allTags.filter((tag) => !tag.isCategory) : allTags
    return [...rows].sort((a, b) => {
      if (a.isCategory !== b.isCategory) return a.isCategory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [allTags, freeOnly])

  /** Sections: each label group, then ungrouped labels last. */
  const tagSections = useMemo(() => {
    const sortRows = (rows: SignalTag[]) =>
      [...rows].sort((a, b) => {
        if (a.isCategory !== b.isCategory) return a.isCategory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    const knownIds = new Set(groups.map((g) => g.id))
    const byGroup = new Map<string | null, SignalTag[]>()
    for (const tag of tags) {
      const key = tag.groupId && knownIds.has(tag.groupId) ? tag.groupId : null
      const list = byGroup.get(key) ?? []
      list.push(tag)
      byGroup.set(key, list)
    }
    const sections: { key: string; group: TagGroup | null; tags: SignalTag[] }[] = groups.map((group) => ({
      key: group.id,
      group,
      tags: sortRows(byGroup.get(group.id) ?? []),
    }))
    const ungrouped = sortRows(byGroup.get(null) ?? [])
    if (ungrouped.length > 0 || sections.length === 0) {
      sections.push({ key: '__none__', group: null, tags: ungrouped })
    }
    return sections
  }, [tags, groups])

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [tagRows, groupRows] = await Promise.all([listSignalTags(token), listTagGroups(token)])
      setTags(tagRows)
      setGroups(groupRows)
    } catch {
      setError(t('tagRegistry.loadFailed'))
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load])

  useEntityRefresh(['tag'], () => void load(), { debounceMs: 800, enabled: Boolean(token) })

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      onChanged?.()
    } catch {
      setError(t('tagRegistry.saveFailed'))
      throw new Error('save_failed')
    } finally {
      setBusy(false)
    }
  }

  const openCreate = () => {
    setDraft(emptyDraft())
    setEditing('new')
  }

  const openEdit = (tag: SignalTag) => {
    setDraft(draftFromTag(tag))
    setEditing(tag)
  }

  const closeEdit = () => setEditing(null)

  const saveEdit = async () => {
    if (!token) return
    const name = normalizeHashtag(draft.name)
    if (!name) return
    try {
      await run(async () => {
        if (editing === 'new') {
          const created = await createSignalTag(token, {
            name,
            description: draft.description,
            color: draft.color,
            showInNav: draft.showInNav,
            groupId: draft.groupId,
          })
          if (created && !draft.aiAutoTag) {
            await updateSignalTag(token, created.id, { ai_auto_tag: false })
          }
          return
        }
        if (!editing) return
        await updateSignalTag(token, editing.id, {
          name,
          description: draft.description,
          color: draft.color,
          show_in_nav: draft.showInNav,
          ai_auto_tag: draft.aiAutoTag,
          ...(draft.groupId ? { group_id: draft.groupId } : { clear_group: true }),
        })
        if (editing.isCategory) {
          await patchCategory(editing.id, { send_mode: draft.alwaysReview ? 'draft' : 'send' })
        }
      })
      closeEdit()
    } catch {
      /* error already set */
    }
  }

  const deleteEditing = async () => {
    if (!token || !editing || editing === 'new') return
    const description = t('tagRegistry.deleteConfirm', { name: editing.name, count: editing.count })
    if (!(await confirm({ description, destructive: true }))) return
    try {
      await run(() => deleteSignalTag(token, editing.id))
      closeEdit()
    } catch {
      /* error already set */
    }
  }

  const editingTag = editing && editing !== 'new' ? editing : null

  const openCreateGroup = () => {
    setGroupName('')
    setGroupExclusive(false)
    setGroupDialogOpen(true)
  }

  const saveGroup = async () => {
    if (!token || !groupName.trim()) return
    try {
      await run(async () => {
        await createTagGroup(token, { name: groupName.trim(), exclusive: groupExclusive })
      })
      setGroupDialogOpen(false)
      setGroupName('')
      setGroupExclusive(false)
    } catch {
      /* error already set */
    }
  }

  return (
    <div id="tags" className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-heading">{t('tagRegistry.title')}</p>
          <p className="mt-0.5 text-xs text-text-secondary">{t('tagRegistry.description')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={openCreateGroup}>
            <Plus size={13} />
            {t('tagRegistry.newGroup')}
          </Button>
          <Button size="sm" variant="secondary" onClick={openCreate}>
            <Plus size={13} />
            {t('tagRegistry.newTag')}
          </Button>
        </div>
      </div>
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <p className="text-2xs text-text-muted">{t('tagRegistry.groupsHint')}</p>

      {tags.length === 0 && groups.length === 0 ? (
        <div className="rounded-lg border border-border/60 px-3 py-3">
          <p className="text-xs text-text-muted">{t('tagRegistry.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tagSections.map((section) => (
            <div key={section.key} className="overflow-hidden rounded-lg border border-border/60">
              <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-bg-elevated/40 px-3 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <p className="text-xs font-medium text-text-heading">
                    {section.group ? section.group.name : t('tagRegistry.ungrouped')}
                  </p>
                  {section.group?.exclusive ? (
                    <Badge variant="neutral" size="sm">
                      {t('tagRegistry.exclusiveOn')}
                    </Badge>
                  ) : null}
                  <span className="text-2xs text-text-muted">
                    {t('tagRegistry.sectionCount', { count: section.tags.length })}
                  </span>
                </div>
                {section.group ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-2xs"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          token
                            ? updateTagGroup(token, section.group!.id, {
                                exclusive: !section.group!.exclusive,
                              }).then(() => undefined)
                            : Promise.resolve(),
                        )
                      }
                    >
                      {section.group.exclusive ? t('tagRegistry.exclusiveOff') : t('tagRegistry.exclusiveOn')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={t('tagRegistry.deleteGroup')}
                      onClick={() =>
                        void run(() =>
                          token ? deleteTagGroup(token, section.group!.id) : Promise.resolve(),
                        )
                      }
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ) : null}
              </div>
              {section.tags.length === 0 ? (
                <p className="px-3 py-2.5 text-2xs text-text-muted">{t('tagRegistry.sectionEmpty')}</p>
              ) : (
                <div className="divide-y divide-border/40">
                  {section.tags.map((tag) => (
                    <EntityRow
                      key={tag.id}
                      density="sm"
                      title={
                        <TagPill
                          names={tag.name}
                          tone={tag.isCategory ? 'action' : 'free'}
                          color={tag.isCategory ? '' : tag.color}
                          size="sm"
                        />
                      }
                      meta={
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          {tag.description ? <span className="truncate-fade">{tag.description}</span> : null}
                          {tag.isCategory ? (
                            <Badge variant="accent" size="sm">
                              {t('tagRegistry.flowBadge')}
                            </Badge>
                          ) : null}
                        </span>
                      }
                      trailing={
                        <>
                          {tag.count > 0 ? (
                            <Link
                              to={openEntityPath({ type: 'tag', name: tag.name })}
                              className="shrink-0 text-2xs text-text-muted hover:text-accent hover:underline"
                              title={t('tagRegistry.openConversations', { name: tag.name })}
                              data-testid="tag-registry-count-link"
                            >
                              {t('tagRegistry.count', { count: tag.count })}
                            </Link>
                          ) : (
                            <span className="shrink-0 text-2xs text-text-muted">
                              {t('tagRegistry.count', { count: tag.count })}
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => openEdit(tag)}
                            aria-label={t('tagRegistry.edit')}
                          >
                            <Pencil size={12} />
                          </Button>
                        </>
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tagRegistry.newGroup')}</DialogTitle>
            <DialogDescription>{t('tagRegistry.newGroupHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">{t('tagRegistry.groupNameLabel')}</Label>
              <Input
                id="group-name"
                autoFocus
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder={t('tagRegistry.groupName')}
                className="h-9"
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-heading">{t('tagRegistry.exclusiveOn')}</p>
                <p className="text-2xs text-text-muted">{t('tagRegistry.exclusiveHint')}</p>
              </div>
              <Switch
                checked={groupExclusive}
                disabled={busy}
                aria-label={t('tagRegistry.exclusiveOn')}
                onCheckedChange={setGroupExclusive}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setGroupDialogOpen(false)} disabled={busy}>
              {t('tagRegistry.cancel')}
            </Button>
            <Button type="button" disabled={busy || !groupName.trim()} onClick={() => void saveGroup()}>
              {t('tagRegistry.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LabelEditDialog
        open={editing != null}
        creating={editing === 'new'}
        tag={editingTag}
        draft={draft}
        groups={groups}
        busy={busy}
        onDraft={setDraft}
        onClose={closeEdit}
        onSave={() => void saveEdit()}
        onDelete={() => void deleteEditing()}
        onPromote={() => {
          if (editingTag) {
            closeEdit()
            setPromoting(editingTag)
          }
        }}
        onSaveAsMap={() => {
          if (editingTag) {
            closeEdit()
            setFolderFor(editingTag)
          }
        }}
      />

      <Dialog open={folderFor != null} onOpenChange={(open) => (!open ? setFolderFor(null) : undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tagRegistry.saveAsMapTitle')}</DialogTitle>
            <DialogDescription>{t('tagRegistry.saveAsMapHint')}</DialogDescription>
          </DialogHeader>
          {folderFor ? (
            <TagPill
              names={folderFor.name}
              tone={folderFor.isCategory ? 'action' : 'free'}
              color={folderFor.isCategory ? '' : folderFor.color}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setFolderFor(null)}>
              {t('tagRegistry.cancel')}
            </Button>
            <Button
              type="button"
              disabled={busy || !folderFor}
              onClick={() =>
                void run(async () => {
                  if (!folderFor) return
                  await createProject({ tag_ids: [folderFor.id], tags: [folderFor.name] })
                  setFolderFor(null)
                  toast.success(t('tagRegistry.mapSaved', { name: folderFor.name }))
                })
              }
            >
              {t('tagRegistry.saveAsMap')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PromoteTagDialog
        tag={promoting}
        onClose={() => setPromoting(null)}
        onPromoted={() => {
          setPromoting(null)
          void load()
          onChanged?.()
        }}
      />
    </div>
  )
}

function LabelEditDialog({
  open,
  creating,
  tag,
  draft,
  groups,
  busy,
  onDraft,
  onClose,
  onSave,
  onDelete,
  onPromote,
  onSaveAsMap,
}: {
  open: boolean
  creating: boolean
  tag: SignalTag | null
  draft: EditDraft
  groups: TagGroup[]
  busy: boolean
  onDraft: (next: EditDraft | ((prev: EditDraft) => EditDraft)) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  onPromote: () => void
  onSaveAsMap: () => void
}) {
  const { t } = useTranslation('nav')
  const canSave = Boolean(normalizeHashtag(draft.name))

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{creating ? t('tagRegistry.newTag') : t('tagRegistry.editTitle')}</DialogTitle>
          <DialogDescription>
            {creating ? t('tagRegistry.createHint') : t('tagRegistry.editHint')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="label-name">{t('tagRegistry.nameLabel')}</Label>
            <Input
              id="label-name"
              autoFocus
              value={draft.name}
              onChange={(e) => onDraft((d) => ({ ...d, name: stripHash(e.target.value) }))}
              placeholder={t('tagRegistry.namePlaceholder')}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="label-description">{t('tagRegistry.descriptionLabel')}</Label>
            <Textarea
              id="label-description"
              value={draft.description}
              onChange={(e) => onDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder={t('tagRegistry.descriptionPlaceholder')}
              rows={3}
              className="min-h-[4.5rem] resize-y text-sm"
            />
          </div>

          {!tag?.isCategory ? (
            <div className="space-y-1.5">
              <Label>{t('tagRegistry.colorLabel')}</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {LABEL_COLORS.map((value) => {
                  const selected = draft.color === value
                  return (
                    <button
                      key={value || 'default'}
                      type="button"
                      title={t(`tagRegistry.color.${value || 'default'}`)}
                      aria-label={t(`tagRegistry.color.${value || 'default'}`)}
                      aria-pressed={selected}
                      onClick={() => onDraft((d) => ({ ...d, color: value }))}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset transition-colors',
                        selected ? 'ring-accent' : 'ring-border/60 hover:ring-border-light',
                      )}
                    >
                      <span
                        className={cn(
                          'h-3.5 w-3.5 rounded-full',
                          value ? COLOR_SWATCH[value] : 'bg-bg-hover ring-1 ring-inset ring-border/70',
                        )}
                      />
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>{t('tagRegistry.group')}</Label>
            <ChoiceSelect
              aria-label={t('tagRegistry.group')}
              triggerClassName="h-9 w-full text-sm"
              value={draft.groupId ?? '__none__'}
              onValueChange={(value) =>
                onDraft((d) => ({ ...d, groupId: value === '__none__' ? null : value }))
              }
              groups={[
                {
                  items: [
                    { value: '__none__', label: t('tagRegistry.noGroup'), kind: 'tag' },
                    ...groups.map((group) => ({
                      value: group.id,
                      label: group.name,
                      kind: 'tag' as const,
                    })),
                  ],
                },
              ]}
            />
          </div>

          <div className="space-y-3 rounded-md border border-border/50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-heading">{t('tagRegistry.pin')}</p>
                <p className="text-2xs text-text-muted">{t('tagRegistry.pinHint')}</p>
              </div>
              <Switch
                checked={draft.showInNav}
                disabled={busy}
                aria-label={t('tagRegistry.pin')}
                onCheckedChange={(checked) => onDraft((d) => ({ ...d, showInNav: checked }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-heading">{t('tagRegistry.aiAutoOn')}</p>
                <p className="text-2xs text-text-muted">{t('tagRegistry.aiAutoHint')}</p>
              </div>
              <Switch
                checked={draft.aiAutoTag}
                disabled={busy}
                aria-label={t('tagRegistry.aiAutoOn')}
                className="data-[state=checked]:border-ai/50 data-[state=checked]:bg-ai/90"
                onCheckedChange={(checked) => onDraft((d) => ({ ...d, aiAutoTag: checked }))}
              />
            </div>
            {tag?.isCategory ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-heading">{t('ai.communication.alwaysReview')}</p>
                </div>
                <Switch
                  checked={draft.alwaysReview}
                  disabled={busy}
                  aria-label={t('ai.communication.alwaysReview')}
                  onCheckedChange={(checked) => onDraft((d) => ({ ...d, alwaysReview: checked }))}
                />
              </div>
            ) : null}
          </div>

          {!creating && tag ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || tag.folders.length > 0}
                onClick={onSaveAsMap}
              >
                <FolderIcon size={12} />
                {t('tagRegistry.saveAsMap')}
              </Button>
              {tag.isCategory && tag.workstreamId ? (
                <Button size="sm" variant="outline" asChild>
                  <Link to={workstreamPath(tag.workstreamId)}>
                    <Workflow size={12} />
                    {t('tagRegistry.openFlow')}
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || tag.isCategory}
                  onClick={onPromote}
                >
                  <Workflow size={12} />
                  {t('tagRegistry.promote')}
                </Button>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {!creating && tag ? (
            <Button type="button" variant="ghost" className="text-status-error" disabled={busy} onClick={onDelete}>
              {t('tagRegistry.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t('tagRegistry.cancel')}
            </Button>
            <Button type="button" disabled={busy || !canSave} onClick={onSave}>
              {t('tagRegistry.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Attach a flow to a free label: an existing one, or a new one named after the label. */
function PromoteTagDialog({
  tag,
  onClose,
  onPromoted,
}: {
  tag: SignalTag | null
  onClose: () => void
  onPromoted: () => void
}) {
  const { t } = useTranslation('nav')
  const [playbooks, setPlaybooks] = useState<WorkstreamRow[]>([])
  const [playbookId, setPlaybookId] = useState(NEW_PLAYBOOK)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tag) return
    setPlaybookId(NEW_PLAYBOOK)
    void listWorkstreams()
      .then(setPlaybooks)
      .catch(() => setPlaybooks([]))
  }, [tag])

  const promote = async () => {
    if (!tag) return
    setBusy(true)
    try {
      await promoteTag(
        tag.id,
        playbookId === NEW_PLAYBOOK ? { playbook_name: tag.name } : { workstream_id: playbookId },
      )
      toast.success(t('tagRegistry.promoted', { name: tag.name }))
      onPromoted()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('tagRegistry.promoteFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={tag != null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            {t('tagRegistry.promoteTitle')}
            {tag ? <TagPill names={tag.name} tone="action" size="sm" /> : null}
          </DialogTitle>
          <DialogDescription>{t('tagRegistry.promoteHint')}</DialogDescription>
        </DialogHeader>
        <ChoiceSelect
          aria-label={t('tagRegistry.playbook')}
          triggerClassName="h-9 text-sm"
          value={playbookId}
          onValueChange={setPlaybookId}
          groups={[
            {
              items: [
                {
                  value: NEW_PLAYBOOK,
                  label: t('tagRegistry.newPlaybook', { name: tag?.name ?? '' }),
                  kind: 'flow',
                  icon: Plus,
                },
                ...playbooks.map((workstream) => ({
                  value: workstream.id,
                  label: workstream.name,
                  kind: 'flow' as const,
                })),
              ],
            },
          ]}
        />
        <p className="text-xs text-text-muted">{t('tagRegistry.promoteAfter')}</p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('tagRegistry.cancel')}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void promote()} className="gap-1">
            <Workflow size={14} />
            {t('tagRegistry.promote')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
