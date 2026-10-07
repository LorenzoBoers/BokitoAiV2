import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Pencil, Pin, PinOff, Plus, Sparkles, Trash2, Workflow, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useEntityRefresh } from '../../lib/live-store'
import { normalizeHashtag, stripHash } from '../../lib/hashtag'
import {
  createSignalTag,
  deleteSignalTag,
  listSignalTags,
  updateSignalTag,
  type SignalTag,
} from '../../lib/signals-api'
import { promoteTag } from '../../lib/tickets-api'
import { listWorkstreams, type WorkstreamRow } from '../../lib/workstreams-api'
import { workstreamPath } from '../../lib/workstream-ui'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
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
import { Hashtag, HashtagMark } from '../ui/HashtagMark'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { Tip } from '../ui/Tip'

type Draft = { name: string; description: string }

const NEW_PLAYBOOK = '__new__'
/** Shared width so "Flow openen" / "Flow aanmaken" keep one column. */
const FLOW_BTN = 'h-7 w-[8.75rem] justify-center gap-1 px-2 text-2xs'

/**
 * Workspace tags in one list. Action tags first (accent #), then free tags.
 * Pin places a tag in Communication; AI auto-tag controls triage. Agents and
 * inbox rules only use tags from this list.
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
  const tags = useMemo(() => {
    const rows = freeOnly ? allTags.filter((tag) => !tag.isCategory) : allTags
    return [...rows].sort((a, b) => {
      if (a.isCategory !== b.isCategory) return a.isCategory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [allTags, freeOnly])
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ name: '', description: '' })
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [promoting, setPromoting] = useState<SignalTag | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      setTags(await listSignalTags(token))
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
      setEditingId(null)
      setCreating(false)
      await load()
      onChanged?.()
    } catch {
      setError(t('tagRegistry.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (tag: SignalTag) => {
    setCreating(false)
    setEditingId(tag.id)
    setDraft({ name: tag.name, description: tag.description })
  }

  const inCommunication = (tag: SignalTag) => (tag.isCategory ? tag.showInNav : tag.pinned)

  const togglePin = (tag: SignalTag) => {
    const next = !inCommunication(tag)
    void run(() =>
      token
        ? updateSignalTag(
            token,
            tag.id,
            tag.isCategory ? { show_in_nav: next } : { pinned: next },
          )
        : Promise.resolve(),
    )
  }

  const editor = (onSave: () => void) => (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <span className="flex h-7 w-40 items-center rounded-md border border-border bg-bg-input pl-2 focus-within:border-accent/60">
        <HashtagMark className="text-xs" />
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: stripHash(e.target.value) }))}
          placeholder={t('tagRegistry.namePlaceholder')}
          aria-label={t('tagRegistry.namePlaceholder')}
          className="h-full min-w-0 flex-1 bg-transparent pl-0.5 pr-2 text-xs text-text-primary focus:outline-none"
        />
      </span>
      <Input
        value={draft.description}
        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        placeholder={t('tagRegistry.descriptionPlaceholder')}
        aria-label={t('tagRegistry.descriptionPlaceholder')}
        className="h-7 min-w-40 flex-1 text-xs"
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || !normalizeHashtag(draft.name)}
        onClick={onSave}
        aria-label={t('tagRegistry.save')}
      >
        <Check size={13} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setEditingId(null)
          setCreating(false)
        }}
        aria-label={t('tagRegistry.cancel')}
      >
        <X size={13} />
      </Button>
    </div>
  )

  return (
    <div id="tags" className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-heading">
            <span className="text-text-muted">#</span> {t('tagRegistry.title')}
          </p>
          <p className="text-xs text-text-secondary">{t('tagRegistry.description')}</p>
        </div>
        {!creating ? (
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => {
              setEditingId(null)
              setDraft({ name: '', description: '' })
              setCreating(true)
            }}
          >
            <Plus size={13} />
            {t('tagRegistry.newTag')}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <div className="divide-y divide-border/40 rounded-lg border border-border/60 px-3">
        {creating
          ? editor(() =>
              void run(() =>
                token
                  ? createSignalTag(token, { name: normalizeHashtag(draft.name), description: draft.description })
                  : Promise.resolve(),
              ),
            )
          : null}
        {tags.length === 0 && !creating ? <p className="py-2 text-xs text-text-muted">{t('tagRegistry.empty')}</p> : null}
        {tags.map((tag) =>
          editingId === tag.id ? (
            <div key={tag.id}>
              {editor(() =>
                void run(() =>
                  token
                    ? updateSignalTag(token, tag.id, {
                        name: normalizeHashtag(draft.name),
                        description: draft.description,
                      })
                    : Promise.resolve(),
                ),
              )}
            </div>
          ) : (
            <div key={tag.id} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-text-heading">
                  <Hashtag name={tag.name} category={tag.isCategory} />
                </p>
                {tag.description ? (
                  <p className="truncate-fade text-2xs text-text-muted">{tag.description}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-2xs text-text-muted">
                {t('tagRegistry.count', { count: tag.count })}
              </span>
              <Tip label={tag.aiAutoTag ? t('tagRegistry.aiAutoOn') : t('tagRegistry.aiAutoOff')}>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Sparkles
                    size={12}
                    className={tag.aiAutoTag ? 'text-ai-ink' : 'text-text-muted'}
                    aria-hidden
                  />
                  <Switch
                    checked={tag.aiAutoTag}
                    disabled={busy}
                    aria-label={tag.aiAutoTag ? t('tagRegistry.aiAutoOn') : t('tagRegistry.aiAutoOff')}
                    className="data-[state=checked]:border-ai/50 data-[state=checked]:bg-ai/90 data-[state=checked]:shadow-[0_0_0_3px_rgb(var(--color-ai)/0.16)]"
                    onCheckedChange={(checked) =>
                      void run(() =>
                        token
                          ? updateSignalTag(token, tag.id, { ai_auto_tag: checked })
                          : Promise.resolve(),
                      )
                    }
                  />
                </div>
              </Tip>
              <Tip label={inCommunication(tag) ? t('tagRegistry.unpin') : t('tagRegistry.pin')}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-pressed={inCommunication(tag)}
                  aria-label={inCommunication(tag) ? t('tagRegistry.unpin') : t('tagRegistry.pin')}
                  className={inCommunication(tag) ? 'text-accent' : undefined}
                  onClick={() => togglePin(tag)}
                >
                  {inCommunication(tag) ? <PinOff size={12} /> : <Pin size={12} />}
                </Button>
              </Tip>
              {tag.isCategory && tag.workstreamId ? (
                <Button size="sm" variant="outline" className={FLOW_BTN} asChild>
                  <Link to={workstreamPath(tag.workstreamId)}>
                    <Workflow size={12} />
                    {t('tagRegistry.openFlow')}
                  </Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className={FLOW_BTN}
                  disabled={busy || tag.isCategory}
                  onClick={() => setPromoting(tag)}
                >
                  <Workflow size={12} />
                  {t('tagRegistry.promote')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => startEdit(tag)}
                aria-label={t('tagRegistry.edit')}
              >
                <Pencil size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t('tagRegistry.delete')}
                onClick={() => {
                  void (async () => {
                    const description = t('tagRegistry.deleteConfirm', { name: tag.name, count: tag.count })
                    if (!(await confirm({ description, destructive: true }))) return
                    void run(() => (token ? deleteSignalTag(token, tag.id) : Promise.resolve()))
                  })()
                }}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          ),
        )}
      </div>
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

/** Attach a flow to a free tag: an existing one, or a new one named after the tag. */
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
            {tag ? <Hashtag name={tag.name} category /> : null}
          </DialogTitle>
          <DialogDescription>{t('tagRegistry.promoteHint')}</DialogDescription>
        </DialogHeader>
        <Select value={playbookId} onValueChange={setPlaybookId}>
          <SelectTrigger className="h-9 text-sm" aria-label={t('tagRegistry.playbook')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW_PLAYBOOK}>{t('tagRegistry.newPlaybook', { name: tag?.name ?? '' })}</SelectItem>
            {playbooks.map((ws) => (
              <SelectItem key={ws.id} value={ws.id}>
                {ws.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
