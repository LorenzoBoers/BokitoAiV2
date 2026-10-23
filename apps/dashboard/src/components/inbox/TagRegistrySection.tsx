import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GitMerge, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { openEntityPath } from '../../lib/open-entity'
import { useEntityRefresh } from '../../lib/live-store'
import { normalizeHashtag, stripHash } from '../../lib/hashtag'
import {
  createSignalTag,
  deleteSignalTag,
  listSignalTags,
  mergeSignalTags,
  type SignalTag,
} from '../../lib/signals-api'
import { createProject } from '../../lib/projects-api'
import { promoteTag } from '../../lib/tickets-api'
import { listWorkstreams, type WorkstreamRow } from '../../lib/flows-api'
import { workstreamPath } from '../../lib/workstream-ui'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { ApiErrorBanner } from '../ui/ApiErrorBanner'
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
import { TagPill } from '../ui/TagPill'

const NEW_PLAYBOOK = '__new__'
const Workflow = ENTITY_ICONS.flow
const FolderIcon = ENTITY_ICONS.folder

/**
 * Flat label list. Free labels stay uncolored. Flow labels keep their mark
 * and open the flow. Color and icon are edited on the flow, not here.
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
  const { token } = useAuth()
  const confirm = useConfirm()
  const [tags, setTags] = useState<SignalTag[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [promoting, setPromoting] = useState<SignalTag | null>(null)
  const [folderFor, setFolderFor] = useState<SignalTag | null>(null)
  const [merging, setMerging] = useState<SignalTag | null>(null)
  const [intoId, setIntoId] = useState('')

  const visible = useMemo(() => {
    const rows = freeOnly ? tags.filter((tag) => !tag.isCategory) : tags
    return [...rows].sort((a, b) => {
      if (a.isCategory !== b.isCategory) return a.isCategory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [freeOnly, tags])

  const load = useCallback(async () => {
    if (!token) return
    try {
      setTags(await listSignalTags(token))
      setError(null)
    } catch {
      setError(t('tagRegistry.loadFailed'))
    }
  }, [t, token])

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

  const saveNew = async () => {
    if (!token) return
    const clean = normalizeHashtag(name)
    if (!clean) return
    try {
      await run(() => createSignalTag(token, { name: clean, description }))
      setCreating(false)
      setName('')
      setDescription('')
    } catch {
      /* error already set */
    }
  }

  const remove = async (tag: SignalTag) => {
    if (!token) return
    const text = t('tagRegistry.deleteConfirm', { name: tag.name, count: tag.count })
    if (!(await confirm({ description: text, destructive: true }))) return
    try {
      await run(() => deleteSignalTag(token, tag.id))
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
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={13} />
          {t('tagRegistry.newTag')}
        </Button>
      </div>
      {error ? <ApiErrorBanner message={error} /> : null}

      {visible.length === 0 ? (
        <EmptyState tone="dashed" size="sm" className="px-3 py-3" title={t('tagRegistry.empty')} />
      ) : (
        <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border">
          {visible.map((tag) => (
            <EntityRow
              key={tag.id}
              density="sm"
              title={
                <span className="inline-flex items-center">
                  <TagPill
                    names={tag.name}
                    tone={tag.isCategory ? 'action' : 'free'}
                    color={tag.color}
                    icon={tag.icon}
                    size="sm"
                  />
                </span>
              }
              meta={tag.description ? <span className="truncate-fade">{tag.description}</span> : null}
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
                  {tag.isCategory && tag.workstreamId ? (
                    <Button size="sm" variant="ghost" asChild>
                      <Link to={workstreamPath(tag.workstreamId)}>
                        <Workflow size={12} />
                        {t('tagRegistry.openFlow')}
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setPromoting(tag)}
                    >
                      <Workflow size={12} />
                      {t('tagRegistry.promote')}
                    </Button>
                  )}
                  {!tag.isCategory ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setMerging(tag)
                        setIntoId('')
                      }}
                    >
                      <GitMerge size={12} />
                      {t('tagRegistry.merge')}
                    </Button>
                  ) : null}
                  {tag.folders.length === 0 ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setFolderFor(tag)}>
                      <FolderIcon size={12} />
                      {t('tagRegistry.saveAsMap')}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={t('tagRegistry.delete')}
                    onClick={() => void remove(tag)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </>
              }
            />
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={(open) => (!open ? setCreating(false) : undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tagRegistry.newTag')}</DialogTitle>
            <DialogDescription>{t('tagRegistry.createHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="label-name">{t('tagRegistry.nameLabel')}</Label>
              <Input
                id="label-name"
                autoFocus
                value={name}
                onChange={(event) => setName(stripHash(event.target.value))}
                placeholder={t('tagRegistry.namePlaceholder')}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label-description">{t('tagRegistry.descriptionLabel')}</Label>
              <Textarea
                id="label-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('tagRegistry.descriptionPlaceholder')}
                rows={3}
                className="min-h-[4.5rem] resize-y text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
              {t('tagRegistry.cancel')}
            </Button>
            <Button type="button" disabled={busy || !normalizeHashtag(name)} onClick={() => void saveNew()}>
              {t('tagRegistry.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              color={folderFor.color}
              icon={folderFor.icon}
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

      <Dialog open={merging != null} onOpenChange={(open) => (!open ? setMerging(null) : undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tagRegistry.mergeTitle', { name: merging?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('tagRegistry.mergeHint', { name: merging?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          <ChoiceSelect
            aria-label={t('tagRegistry.mergeInto')}
            triggerClassName="h-9 text-sm"
            value={intoId}
            onValueChange={setIntoId}
            placeholder={t('tagRegistry.mergeInto')}
            groups={[
              {
                items: visible
                  .filter((tag) => tag.id !== merging?.id && !tag.isCategory)
                  .map((tag) => ({ value: tag.id, label: tag.name, kind: 'tag' as const })),
              },
            ]}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setMerging(null)} disabled={busy}>
              {t('tagRegistry.cancel')}
            </Button>
            <Button
              type="button"
              disabled={busy || !intoId || !merging || !token}
              onClick={() => {
                if (!token || !merging || !intoId) return
                const spare = merging.name
                const kept = visible.find((tag) => tag.id === intoId)?.name ?? ''
                void run(async () => {
                  await mergeSignalTags(token, merging.id, intoId)
                  setMerging(null)
                  setIntoId('')
                  toast.success(t('tagRegistry.merged', { name: spare, into: kept }))
                }).catch(() => undefined)
              }}
            >
              {t('tagRegistry.merge')}
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
