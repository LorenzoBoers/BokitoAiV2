import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import {
  Code2,
  ExternalLink,
  FileSpreadsheet,
  Folder,
  GitBranch,
  Globe,
  SquareKanban,
  Link2,
  Loader2,
  NotebookText,
  Paperclip,
  Plug,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { ResourceRowsSkeleton } from '../ui/skeleton'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { CANVAS_ICON } from '../../lib/entity-icons'
import {
  addWorksIn,
  deleteProjectResource,
  listWorksIn,
  type WorksInAddKind,
  type WorksInItem,
} from '../../lib/project-work-api'
import { listIntegrationConnections, type IntegrationConnectionRow } from '../../lib/integrations-api'

const KIND_ICON: Record<string, typeof Folder> = {
  board: SquareKanban,
  files: Paperclip,
  canvas: CANVAS_ICON,
  connection: Plug,
  drive: Folder,
  repo: GitBranch,
  notion: NotebookText,
  sheet: FileSpreadsheet,
  vibecode: Code2,
  site: Globe,
}

const ADD_KINDS: WorksInAddKind[] = ['canvas', 'connection', 'drive']

function ItemCard({
  item,
  canRemove,
  busy,
  onRemove,
}: {
  item: WorksInItem
  canRemove: boolean
  busy: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation('nav')
  const Icon = KIND_ICON[item.kind] ?? Link2
  const external = Boolean(item.href && /^https?:\/\//.test(item.href))
  const label = item.label || t(`projects.worksIn.kind.${item.kind}`, { defaultValue: item.kind })
  const body = (
    <>
      <Icon size={16} className="shrink-0 text-text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate-fade text-sm font-medium text-text-primary">{label}</span>
          {item.canvas_kind ? (
            <Badge variant="neutral" size="sm">
              {t(`projects.canvas.kinds.${item.canvas_kind}`, { defaultValue: item.canvas_kind })}
            </Badge>
          ) : null}
        </span>
        <span className="flex items-center gap-1 text-xs text-text-muted">
          {item.origin === 'connection' ? <Link2 size={11} aria-hidden /> : null}
          {t(`projects.worksIn.origin.${item.origin}`)}
          {item.count != null ? ` · ${item.count}` : ''}
          {item.detail ? ` · ${item.detail}` : ''}
        </span>
      </span>
      {external ? <ExternalLink size={12} className="shrink-0 text-text-muted" aria-hidden /> : null}
    </>
  )
  const className =
    'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-bg-muted/40'
  return (
    <li
      className="panel flex items-center gap-1"
      data-testid="works-in-item"
      data-key={item.key}
    >
      {item.href && external ? (
        <a href={item.href} target="_blank" rel="noreferrer" className={className}>
          {body}
        </a>
      ) : item.href ? (
        <Link to={item.href} className={className}>
          {body}
        </Link>
      ) : (
        <span className={className}>{body}</span>
      )}
      {canRemove ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="mr-1 px-1.5 text-text-muted hover:text-status-error"
          disabled={busy}
          title={t('projects.worksIn.remove')}
          onClick={onRemove}
        >
          <Trash2 size={12} />
        </Button>
      ) : null}
    </li>
  )
}

/** Opening a folder with this hash starts adding an item (the Grid links here). */
export const WORKS_IN_ADD_HASH = '#works-in-add'

/** Works in: every place inside this folder where work lands, one card each. */
export function WorksInSection({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { t } = useTranslation('nav')
  const { hash } = useLocation()
  const [items, setItems] = useState<WorksInItem[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(() => canEdit && hash === WORKS_IN_ADD_HASH)
  useEffect(() => {
    if (canEdit && hash === WORKS_IN_ADD_HASH) setAdding(true)
  }, [canEdit, hash])
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<WorksInAddKind>('canvas')
  const [title, setTitle] = useState('')
  const [ref, setRef] = useState('')
  const [connections, setConnections] = useState<IntegrationConnectionRow[]>([])
  const [connectionId, setConnectionId] = useState('')

  const load = useCallback(async () => {
    try {
      setItems(await listWorksIn(projectId))
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!adding || kind !== 'connection') return
    listIntegrationConnections()
      .then((rows) => setConnections(rows.filter((row) => row.status === 'active')))
      .catch(() => setConnections([]))
  }, [adding, kind])

  const linkable = connections
  const canSubmit =
    kind === 'connection' ? Boolean(connectionId) : kind === 'drive' ? Boolean(ref.trim() || title.trim()) : true

  const reset = () => {
    setTitle('')
    setRef('')
    setConnectionId('')
    setAdding(false)
  }

  const add = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      await addWorksIn(projectId, {
        kind,
        title: title.trim(),
        ...(kind === 'connection' ? { connection_id: connectionId } : {}),
        ...(kind === 'drive' ? { external_ref: ref.trim() } : {}),
      })
      reset()
      toast.success(t('projects.worksIn.added'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.worksIn.addError')))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: WorksInItem) => {
    setBusy(true)
    try {
      await deleteProjectResource(projectId, item.key.slice('resource:'.length))
      toast.success(t('projects.worksIn.removed'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.worksIn.removeError')))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <ResourceRowsSkeleton />
  if (items.length === 0 && !canEdit) return null

  return (
    <section className="space-y-2" aria-labelledby="project-works-in" data-testid="works-in-section">
      <div className="flex items-center justify-between gap-2">
        <h2 id="project-works-in" className="text-sm font-semibold text-text-heading">
          {t('projects.worksIn.title')}
        </h2>
        {canEdit && !adding ? (
          <Button type="button" size="xs" variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={13} className="mr-1" />
            {t('projects.worksIn.add')}
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-text-muted">{t('projects.worksIn.empty')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <ItemCard
              key={item.key}
              item={item}
              canRemove={canEdit && item.key.startsWith('resource:') && item.kind !== 'repo'}
              busy={busy}
              onRemove={() => void remove(item)}
            />
          ))}
        </ul>
      )}

      {canEdit && adding ? (
        <div className="space-y-2 rounded-md border border-border p-2.5">
          <div className="flex flex-wrap gap-2">
            <ChoiceSelect
              aria-label={t('projects.worksIn.add')}
              triggerClassName="h-8 w-36 text-sm"
              value={kind}
              onValueChange={(value) => setKind(value as WorksInAddKind)}
              groups={[
                {
                  items: ADD_KINDS.map((value) => ({
                    value,
                    label: t(`projects.worksIn.addKind.${value}`),
                    kind: 'icon' as const,
                    icon: KIND_ICON[value],
                  })),
                },
              ]}
            />
            {kind === 'connection' ? (
              <ChoiceSelect
                aria-label={t('projects.worksIn.connectionPick')}
                placeholder={t('projects.worksIn.connectionPick')}
                triggerClassName="h-8 min-w-36 flex-1 text-sm"
                value={connectionId}
                onValueChange={setConnectionId}
                groups={[
                  {
                    items: linkable.map((conn) => ({
                      value: conn.id,
                      label: conn.display_name || conn.provider || conn.id,
                      kind: 'icon' as const,
                      brandSlug: conn.provider || conn.provider_id,
                    })),
                  },
                ]}
              />
            ) : (
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t(
                  kind === 'canvas' ? 'projects.worksIn.canvasPlaceholder' : 'projects.worksIn.labelPlaceholder',
                )}
                className="h-8 min-w-36 flex-1 text-sm"
              />
            )}
          </div>
          {kind === 'drive' ? (
            <Input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder={t('projects.worksIn.refPlaceholder')}
              className="h-8 text-sm"
            />
          ) : null}
          <p className="text-xs text-text-muted">
            {kind === 'connection'
              ? linkable.length === 0
                ? t('projects.worksIn.connectionNone')
                : t('projects.worksIn.connectionHint')
              : t(`projects.worksIn.addHint.${kind}`)}
          </p>
          <div className="flex justify-end gap-1.5">
            <Button type="button" size="xs" variant="ghost" onClick={reset}>
              <X size={12} className="mr-1" />
              {t('projects.work.cancel')}
            </Button>
            <Button type="button" size="xs" disabled={busy || !canSubmit} onClick={() => void add()}>
              {busy ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Plus size={12} className="mr-1" />}
              {t('projects.work.add')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
