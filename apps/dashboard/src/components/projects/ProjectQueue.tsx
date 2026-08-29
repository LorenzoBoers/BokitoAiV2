import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { TableRowsSkeleton } from '../ui/skeleton'
import { formatAppTime } from '../../lib/app-locale'
import { inboxPath } from '../../lib/messages-paths'
import {
  analyzeQueueItem,
  createQueueItem,
  listQueueItems,
  patchQueueItem,
  verifyQueueItem,
  type QueueItemKind,
  type QueueItemPriority,
  type QueueItemRow,
  type QueueItemStatus,
} from '../../lib/project-work-api'
import {
  QUEUE_KIND_VARIANT,
  QUEUE_STATUS_ORDER,
  QUEUE_STATUS_VARIANT,
  QUEUE_TRANSITIONS,
  SECTION_STATUS_VARIANT,
} from './projectWorkBadges'

const KINDS: QueueItemKind[] = ['feature', 'bug', 'task', 'idea', 'risk']
const PRIORITIES: QueueItemPriority[] = ['low', 'normal', 'high', 'urgent']

export function ProjectQueue({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation('nav')
  const [items, setItems] = useState<QueueItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [newTitle, setNewTitle] = useState('')
  const [newKind, setNewKind] = useState<QueueItemKind>('feature')
  const [newPriority, setNewPriority] = useState<QueueItemPriority>('normal')
  const [newBody, setNewBody] = useState('')
  const [creating, setCreating] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(await listQueueItems(projectId))
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.work.queueLoadError')))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const groups = useMemo(() => {
    const byStatus = new Map<QueueItemStatus, QueueItemRow[]>()
    for (const item of items) {
      const list = byStatus.get(item.status) ?? []
      list.push(item)
      byStatus.set(item.status, list)
    }
    return QUEUE_STATUS_ORDER.filter((status) => byStatus.has(status)).map((status) => ({
      status,
      items: byStatus.get(status) ?? [],
    }))
  }, [items])

  const create = async () => {
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      await createQueueItem(projectId, {
        title: newTitle.trim(),
        kind: newKind,
        priority: newPriority,
        body: newBody.trim(),
      })
      setNewTitle('')
      setNewBody('')
      setComposerOpen(false)
      toast.success(t('projects.work.queueCreated'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.work.queueCreateError')))
    } finally {
      setCreating(false)
    }
  }

  const transition = async (item: QueueItemRow, status: QueueItemStatus) => {
    setBusyId(item.id)
    try {
      await patchQueueItem(projectId, item.id, { status })
      toast.success(t('projects.work.statusUpdated'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.work.statusUpdateError')))
    } finally {
      setBusyId(null)
    }
  }

  const runAnalyze = async (item: QueueItemRow) => {
    setBusyId(item.id)
    try {
      await analyzeQueueItem(projectId, item.id)
      toast.success(t('projects.work.analyzeStarted'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.work.analyzeError')))
    } finally {
      setBusyId(null)
    }
  }

  const runVerify = async (item: QueueItemRow) => {
    setBusyId(item.id)
    try {
      await verifyQueueItem(projectId, item.id)
      toast.success(t('projects.work.verifyStarted'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.work.verifyError')))
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <TableRowsSkeleton rows={4} />
  if (error) return <ApiErrorBanner message={error} onRetry={() => void load()} />

  return (
    <div className="space-y-4">
      {canEdit ? (
        <Card className="p-3">
          {!composerOpen ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setComposerOpen(true)}>
              <Plus size={14} className="mr-1" />
              {t('projects.work.addToQueue')}
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t('projects.work.titlePlaceholder')}
                  className="h-9 min-w-52 flex-1 text-sm"
                  autoFocus
                />
                <Select value={newKind} onValueChange={(v) => setNewKind(v as QueueItemKind)}>
                  <SelectTrigger className="h-9 w-32 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`projects.work.kind.${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={newPriority}
                  onValueChange={(v) => setNewPriority(v as QueueItemPriority)}
                >
                  <SelectTrigger className="h-9 w-32 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {t(`projects.work.priority.${priority}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder={t('projects.work.bodyPlaceholder')}
                className="min-h-16 text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setComposerOpen(false)}>
                  {t('projects.work.cancel')}
                </Button>
                <Button type="button" size="sm" disabled={creating || !newTitle.trim()} onClick={() => void create()}>
                  {creating ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Plus size={13} className="mr-1" />}
                  {t('projects.work.add')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {groups.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm font-medium text-text-heading">{t('projects.work.queueEmptyTitle')}</p>
          <p className="mt-1 text-sm text-text-muted">{t('projects.work.queueEmptyBody')}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {canEdit ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setComposerOpen(true)}>
                <Plus size={13} className="mr-1" />
                {t('projects.work.addToQueue')}
              </Button>
            ) : null}
            <Link
              to={inboxPath('open')}
              className="rounded-md border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
            >
              {t('projects.work.openCommunication')}
            </Link>
          </div>
        </Card>
      ) : (
        groups.map((group) => (
          <section key={group.status} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant={QUEUE_STATUS_VARIANT[group.status]} className="px-2 py-0.5 text-[11px]">
                {t(`projects.work.status.${group.status}`)}
              </Badge>
              <span className="text-xs text-text-muted">{group.items.length}</span>
            </div>
            <ul className="space-y-1.5">
              {group.items.map((item) => {
                const expanded = expandedId === item.id
                const nextStatuses = QUEUE_TRANSITIONS[item.status] ?? []
                return (
                  <li key={item.id}>
                    <Card className="overflow-hidden p-0">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-hover/50"
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                      >
                        {expanded ? (
                          <ChevronDown size={14} className="shrink-0 text-text-muted" />
                        ) : (
                          <ChevronRight size={14} className="shrink-0 text-text-muted" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{item.title}</span>
                        <Badge variant={QUEUE_KIND_VARIANT[item.kind]} className="px-1.5 py-0 text-[10px]">
                          {t(`projects.work.kind.${item.kind}`)}
                        </Badge>
                        {item.priority !== 'normal' ? (
                          <Badge
                            variant={item.priority === 'low' ? 'neutral' : 'warning'}
                            className="px-1.5 py-0 text-[10px]"
                          >
                            {t(`projects.work.priority.${item.priority}`)}
                          </Badge>
                        ) : null}
                        {item.signal_id ? (
                          <MessageSquare size={13} className="shrink-0 text-text-muted" aria-hidden />
                        ) : null}
                        {item.links.length > 0 ? (
                          <span className="shrink-0 text-[11px] text-text-muted">
                            {t('projects.work.linkedSections', { count: item.links.length })}
                          </span>
                        ) : null}
                      </button>

                      {expanded ? (
                        <div className="space-y-3 border-t border-border/50 px-3 py-3">
                          {item.body ? (
                            <p className="whitespace-pre-wrap text-sm text-text-secondary">{item.body}</p>
                          ) : null}
                          {item.impact_summary ? (
                            <div className="rounded-md border border-border/50 bg-bg-input/40 px-2.5 py-2">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                                {t('projects.work.impactSummary')}
                              </p>
                              <p className="mt-0.5 whitespace-pre-wrap text-sm text-text-secondary">
                                {item.impact_summary}
                              </p>
                            </div>
                          ) : null}
                          {item.links.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {item.links.map((link) => (
                                <Badge
                                  key={link.id}
                                  variant={SECTION_STATUS_VARIANT[link.section_status]}
                                  className="px-2 py-0.5 text-[11px] font-normal"
                                  title={t(`projects.work.sectionStatus.${link.section_status}`)}
                                >
                                  {link.heading || link.anchor}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                            <span>
                              {t(`projects.work.origin.${item.origin_type}`, {
                                defaultValue: item.origin_type,
                              })}
                            </span>
                            {item.created_at ? (
                              <span>{formatAppTime(new Date(item.created_at), i18n.language)}</span>
                            ) : null}
                            {item.signal_id ? (
                              <Link
                                to={inboxPath('all', item.signal_id)}
                                className="inline-flex items-center gap-1 text-accent hover:underline"
                              >
                                <MessageSquare size={12} />
                                {t('projects.work.openThread')}
                              </Link>
                            ) : null}
                          </div>
                          {canEdit ? (
                            <div className="flex flex-wrap gap-1.5 border-t border-border/40 pt-2.5">
                              {nextStatuses.map((status) => (
                                <Button
                                  key={status}
                                  type="button"
                                  size="sm"
                                  variant={status === 'rejected' ? 'ghost' : 'outline'}
                                  className="h-7 px-2 text-xs"
                                  disabled={busyId === item.id}
                                  onClick={() => void transition(item, status)}
                                >
                                  {t(`projects.work.moveTo.${status}`)}
                                </Button>
                              ))}
                              {['accepted', 'analyzing', 'planned'].includes(item.status) ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 px-2 text-xs"
                                  disabled={busyId === item.id}
                                  onClick={() => void runAnalyze(item)}
                                >
                                  {busyId === item.id ? (
                                    <Loader2 size={12} className="mr-1 animate-spin" />
                                  ) : (
                                    <Search size={12} className="mr-1" />
                                  )}
                                  {t('projects.work.analyze')}
                                </Button>
                              ) : null}
                              {['in_progress', 'verifying'].includes(item.status) ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 px-2 text-xs"
                                  disabled={busyId === item.id}
                                  onClick={() => void runVerify(item)}
                                >
                                  {busyId === item.id ? (
                                    <Loader2 size={12} className="mr-1 animate-spin" />
                                  ) : (
                                    <ShieldCheck size={12} className="mr-1" />
                                  )}
                                  {t('projects.work.verify')}
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </Card>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
