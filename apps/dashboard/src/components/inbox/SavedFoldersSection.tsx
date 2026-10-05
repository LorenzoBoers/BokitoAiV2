import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { listCaseTypes, type CaseTypeRow, type TicketStageKind } from '../../lib/cases-api'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { signalTypeLabel } from '../../lib/signal-type-catalog'
import {
  createInboxFolder,
  deleteInboxFolder,
  listInboxFolders,
  listSignalTags,
  updateInboxFolder,
  type FolderFilter,
  type InboxFolder,
  type SignalTag,
} from '../../lib/signals-api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

type Draft = { name: string; filter: FolderFilter; personal: boolean }

const EMPTY_DRAFT: Draft = { name: '', filter: {}, personal: false }
const STAGE_KINDS: TicketStageKind[] = ['open', 'waiting', 'done']

const selectClass =
  'h-7 rounded-md border border-border bg-bg-surface px-2 text-xs text-text-primary focus:border-accent/50 focus:outline-none'

/**
 * Saved folders: named filters over project, category, tag and stage that show
 * under Folders in the Communication sidebar. Project folders are computed and
 * do not appear here.
 */
export function SavedFoldersSection() {
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const [folders, setFolders] = useState<InboxFolder[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [categories, setCategories] = useState<CaseTypeRow[]>([])
  const [tags, setTags] = useState<SignalTag[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const rows = await listInboxFolders(token)
      setFolders(rows.filter((row) => row.kind === 'saved'))
    } catch {
      setError(t('savedFolders.loadFailed'))
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!token) return
    void Promise.all([
      listProjects().catch(() => []),
      listCaseTypes().catch(() => []),
      listSignalTags(token).catch(() => []),
    ]).then(([projectRows, typeRows, tagRows]) => {
      setProjects(projectRows)
      setCategories(typeRows.filter((row) => row.enabled))
      setTags(tagRows)
    })
  }, [token])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setEditingId(null)
      setCreating(false)
      await load()
    } catch {
      setError(t('savedFolders.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const setFilter = (key: keyof FolderFilter, value: string) =>
    setDraft((d) => {
      const filter = { ...d.filter }
      if (value) filter[key] = value
      else delete filter[key]
      return { ...d, filter }
    })

  const hasFilter = Object.keys(draft.filter).length > 0

  const move = (index: number, delta: number) => {
    const next = [...folders]
    const [row] = next.splice(index, 1)
    next.splice(index + delta, 0, row)
    void run(() =>
      Promise.all(
        next.map((folder, position) =>
          token && folder.position !== position
            ? updateInboxFolder(token, folder.id, { position })
            : Promise.resolve(null),
        ),
      ),
    )
  }

  const filterSummary = (filter: FolderFilter): string => {
    const parts: string[] = []
    if (filter.project_id) {
      parts.push(projects.find((row) => row.id === filter.project_id)?.name ?? t('savedFolders.project'))
    }
    if (filter.category_id) {
      const type = categories.find((row) => row.id === filter.category_id)
      parts.push(type ? signalTypeLabel(type, i18n.language) : t('savedFolders.category'))
    }
    if (filter.tag) parts.push(`#${filter.tag}`)
    if (filter.stage) {
      parts.push(
        STAGE_KINDS.includes(filter.stage as TicketStageKind)
          ? t(`savedFolders.stageKinds.${filter.stage}`)
          : filter.stage,
      )
    }
    return parts.join(' · ')
  }

  const editor = (onSave: () => void, allowScope: boolean) => (
    <div className="space-y-2 py-2">
      <Input
        autoFocus
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        placeholder={t('savedFolders.namePlaceholder')}
        aria-label={t('savedFolders.namePlaceholder')}
        className="h-7 w-full max-w-xs text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={draft.filter.project_id ?? ''}
          onChange={(e) => setFilter('project_id', e.target.value)}
          className={selectClass}
          aria-label={t('savedFolders.project')}
        >
          <option value="">
            {t('savedFolders.project')}: {t('savedFolders.any')}
          </option>
          {projects.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <select
          value={draft.filter.category_id ?? ''}
          onChange={(e) => setFilter('category_id', e.target.value)}
          className={selectClass}
          aria-label={t('savedFolders.category')}
        >
          <option value="">
            {t('savedFolders.category')}: {t('savedFolders.any')}
          </option>
          {categories.map((row) => (
            <option key={row.id} value={row.id}>
              {signalTypeLabel(row, i18n.language)}
            </option>
          ))}
        </select>
        <select
          value={draft.filter.tag ?? ''}
          onChange={(e) => setFilter('tag', e.target.value)}
          className={selectClass}
          aria-label={t('savedFolders.tag')}
        >
          <option value="">
            {t('savedFolders.tag')}: {t('savedFolders.any')}
          </option>
          {tags.map((row) => (
            <option key={row.id} value={row.name}>
              {row.name}
            </option>
          ))}
        </select>
        <select
          value={draft.filter.stage ?? ''}
          onChange={(e) => setFilter('stage', e.target.value)}
          className={selectClass}
          aria-label={t('savedFolders.stage')}
        >
          <option value="">
            {t('savedFolders.stage')}: {t('savedFolders.any')}
          </option>
          {STAGE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`savedFolders.stageKinds.${kind}`)}
            </option>
          ))}
          {draft.filter.stage && !STAGE_KINDS.includes(draft.filter.stage as TicketStageKind) ? (
            <option value={draft.filter.stage}>{draft.filter.stage}</option>
          ) : null}
        </select>
        {allowScope ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={draft.personal}
              onChange={(e) => setDraft((d) => ({ ...d, personal: e.target.checked }))}
            />
            {t('savedFolders.personal')}
          </label>
        ) : null}
      </div>
      {!hasFilter ? <p className="text-2xs text-text-muted">{t('savedFolders.needsFilter')}</p> : null}
      <div className="flex gap-1">
        <Button size="sm" disabled={busy || !draft.name.trim() || !hasFilter} onClick={onSave}>
          <Check size={13} />
          {t('savedFolders.save')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setEditingId(null)
            setCreating(false)
          }}
        >
          <X size={13} />
          {t('savedFolders.cancel')}
        </Button>
      </div>
    </div>
  )

  return (
    <div className="border-b border-border/40 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-heading">{t('savedFolders.title')}</p>
          <p className="text-xs text-text-secondary">{t('savedFolders.description')}</p>
        </div>
        {!creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditingId(null)
              setDraft(EMPTY_DRAFT)
              setCreating(true)
            }}
          >
            <Plus size={13} />
            {t('savedFolders.newFolder')}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
      <div className="mt-2 divide-y divide-border/40">
        {creating
          ? editor(
              () =>
                void run(() =>
                  token
                    ? createInboxFolder(token, {
                        name: draft.name.trim(),
                        filter: draft.filter,
                        scope: draft.personal ? 'personal' : 'workspace',
                      })
                    : Promise.resolve(),
                ),
              true,
            )
          : null}
        {folders.length === 0 && !creating ? (
          <p className="py-2 text-xs text-text-muted">{t('savedFolders.empty')}</p>
        ) : null}
        {folders.map((folder, index) =>
          editingId === folder.id ? (
            <div key={folder.id}>
              {editor(
                () =>
                  void run(() =>
                    token
                      ? updateInboxFolder(token, folder.id, { name: draft.name.trim(), filter: draft.filter })
                      : Promise.resolve(),
                  ),
                false,
              )}
            </div>
          ) : (
            <div key={folder.id} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate-fade text-xs font-medium text-text-heading">
                  {folder.name}
                  {folder.scope === 'personal' ? (
                    <span className="ml-1.5 text-2xs font-normal text-text-muted">
                      {t('savedFolders.personalBadge')}
                    </span>
                  ) : null}
                </p>
                <p className="truncate-fade text-2xs text-text-muted">{filterSummary(folder.filter)}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
                aria-label={t('savedFolders.moveUp')}
              >
                <ArrowUp size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || index === folders.length - 1}
                onClick={() => move(index, 1)}
                aria-label={t('savedFolders.moveDown')}
              >
                <ArrowDown size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setCreating(false)
                  setEditingId(folder.id)
                  setDraft({ name: folder.name, filter: folder.filter, personal: folder.scope === 'personal' })
                }}
                aria-label={t('savedFolders.edit')}
              >
                <Pencil size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t('savedFolders.delete')}
                onClick={() => {
                  if (!window.confirm(t('savedFolders.deleteConfirm', { name: folder.name }))) return
                  void run(() => (token ? deleteInboxFolder(token, folder.id) : Promise.resolve()))
                }}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
