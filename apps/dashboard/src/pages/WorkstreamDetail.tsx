import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toastMovedToBin } from '../lib/bin-toast'
import { ArrowLeft, Check, Loader2, MoreHorizontal, PauseCircle, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { PageContent } from '../components/layout/PageContent'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ChoiceSelect } from '../components/ui/ChoiceSelect'
import { Hashtag } from '../components/ui/HashtagMark'
import { TagPill } from '../components/ui/TagPill'
import { Tip } from '../components/ui/Tip'
import { FlowTicketBoard, FlowTicketBoardSkeleton } from '../components/workstreams/FlowTicketBoard'
import { StageProgressIcon } from '../components/workstreams/StageProgressIcon'
import { WorkstreamStagesCard, type StagesDraft } from '../components/workstreams/WorkstreamStagesCard'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { flowActionTag, flowTitle } from '../lib/flow-title'
import { useEntityRefresh } from '../lib/live-store'
import { inboxPath, tagPath } from '../lib/messages-paths'
import { withNavReveal } from '../lib/nav-reveal'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listSignalTags, type SignalTag } from '../lib/signals-api'
import { cn } from '../lib/utils'
import type { FlowBoard, TicketStageKind } from '../lib/tickets-api'
import { timeAgo } from '../lib/time-ago'
import {
  deleteWorkstream,
  getWorkstream,
  getWorkstreamBoard,
  patchWorkstream,
  type WorkstreamDetail as WorkstreamDetailPayload,
} from '../lib/workstreams-api'

const CalendarClock = ENTITY_ICONS.agenda
const FolderKanban = ENTITY_ICONS.project
const MessageSquare = ENTITY_ICONS.conversation

const KIND_ORDER: TicketStageKind[] = ['open', 'waiting', 'done', 'closed']

/**
 * A flow: the stage pipeline of one action tag. View mode is the live ticket
 * board (stages x projects); edit mode (admins) unlocks the definition.
 * Projects attach flows from the project page; here they are only shown.
 */
export default function WorkstreamDetail() {
  const { t } = useTranslation('nav')
  const { workstreamId } = useParams<{ workstreamId: string }>()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const { token } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workstream, setWorkstream] = useState<WorkstreamDetailPayload | null>(null)
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [board, setBoard] = useState<FlowBoard | null>(null)
  const [boardError, setBoardError] = useState<string | null>(null)

  const [searchParams] = useSearchParams()
  const [editing, setEditing] = useState(() => searchParams.get('edit') === '1')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [freeTags, setFreeTags] = useState<SignalTag[]>([])
  const [bindingTag, setBindingTag] = useState(false)
  const [stagesDraft, setStagesDraft] = useState<StagesDraft | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)

  const loadBoard = useCallback(async () => {
    if (!workstreamId) return
    try {
      setBoard(await getWorkstreamBoard(workstreamId))
      setBoardError(null)
    } catch (err) {
      setBoardError(formatApiErrorMessage(err, t('workstreamsPage.board.loadError')))
    }
  }, [workstreamId, t])

  const load = useCallback(async () => {
    if (!workstreamId) return
    setLoading(true)
    setError(null)
    try {
      const [detail, projectRows] = await Promise.all([
        getWorkstream(workstreamId),
        listProjects().catch(() => [] as ProjectRow[]),
      ])
      setWorkstream(detail)
      setProjects(projectRows)
      setName(flowTitle(detail))
      setDescription(detail.description ?? '')
    } catch (err) {
      setError(formatApiErrorMessage(err, t('workstreamsPage.loadError')))
    } finally {
      setLoading(false)
    }
    void loadBoard()
  }, [workstreamId, t, loadBoard])

  useEffect(() => {
    void load()
  }, [load])

  useEntityRefresh(['ticket', 'project', 'tag'], () => void loadBoard(), { debounceMs: 800 })

  const tag = workstream?.tags?.[0] ?? null
  const titleName = workstream ? flowTitle(workstream) : name
  const actionTag = workstream ? flowActionTag(workstream) : ''
  const canEdit = isAdmin && editing

  useEffect(() => {
    if (!canEdit || tag || !token) return
    void listSignalTags(token)
      .then((rows) => setFreeTags(rows.filter((row) => !row.workstreamId)))
      .catch(() => setFreeTags([]))
  }, [canEdit, tag, token])

  const linkedProjects = useMemo(() => {
    const ids = new Set(workstream?.project_ids ?? [])
    return projects.filter((p) => ids.has(p.id))
  }, [projects, workstream?.project_ids])

  const nextName = name.trim()
  const nameDirty = Boolean(workstream) && nextName !== titleName
  const descriptionDirty = Boolean(workstream) && description.trim() !== (workstream?.description ?? '')
  const dirty = nameDirty || descriptionDirty || Boolean(stagesDraft?.dirty)
  const valid = Boolean(nextName) && (stagesDraft?.valid ?? true)

  useEffect(() => {
    if (!canEdit || !dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [canEdit, dirty])

  const startEditing = () => {
    if (!workstream) return
    setName(titleName)
    setDescription(workstream.description ?? '')
    setStagesDraft(null)
    setEditing(true)
  }

  const leaveEditing = () => {
    setDiscardOpen(false)
    setEditing(false)
    setStagesDraft(null)
    if (workstream) {
      setName(flowTitle(workstream))
      setDescription(workstream.description ?? '')
    }
  }

  const cancelEditing = () => {
    if (dirty) setDiscardOpen(true)
    else leaveEditing()
  }

  const saveEdits = async () => {
    if (!workstream || !dirty || !valid) return
    setSavingMeta(true)
    try {
      await patchWorkstream(workstream.id, {
        ...(nameDirty ? { name: nextName.slice(0, 120) } : {}),
        ...(descriptionDirty ? { description: description.trim() } : {}),
        ...(stagesDraft?.dirty ? { stages: stagesDraft.stages } : {}),
      })
      const fresh = await getWorkstream(workstream.id)
      setWorkstream(fresh)
      setName(flowTitle(fresh))
      setDescription(fresh.description ?? '')
      setStagesDraft(null)
      setEditing(false)
      toast.success(t('workstreamsPage.editBar.saved'))
      void loadBoard()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.saveError')))
    } finally {
      setSavingMeta(false)
    }
  }

  const bindTag = async (tagId: string) => {
    if (!workstream) return
    setBindingTag(true)
    try {
      const updated = await patchWorkstream(workstream.id, { tag_ids: [tagId] })
      setWorkstream((prev) => (prev ? { ...prev, ...updated } : prev))
      setName(flowTitle(updated))
      void loadBoard()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.saveError')))
    } finally {
      setBindingTag(false)
    }
  }

  const toggleEnabled = async (checked: boolean) => {
    if (!workstream) return
    setTogglingEnabled(true)
    try {
      const updated = await patchWorkstream(workstream.id, { enabled: checked })
      setWorkstream((prev) => (prev ? { ...prev, ...updated } : prev))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.saveError')))
    } finally {
      setTogglingEnabled(false)
    }
  }

  const confirmDelete = async () => {
    if (!workstream) return
    setDeleting(true)
    try {
      await deleteWorkstream(workstream.id)
      toastMovedToBin(t('workstreamsPage.deleted'), navigate)
      navigate('/workstreams')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.deleteError')))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <PageContent width="full" className="space-y-4 py-1">
      <Link
        to="/workstreams"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft size={14} />
        {t('workstreamsPage.back')}
      </Link>

      {loading ? (
        <CardGridSkeleton cards={3} className="lg:grid-cols-1" />
      ) : error || !workstream ? (
        <ApiErrorBanner message={error ?? t('workstreamsPage.notFound')} onRetry={() => void load()} />
      ) : (
        <>
          <header className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {canEdit ? (
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveEdits()
                      if (e.key === 'Escape') cancelEditing()
                    }}
                    placeholder={t('workstreamsPage.nameLabel')}
                    aria-label={t('workstreamsPage.nameLabel')}
                    disabled={savingMeta}
                    className={cn(
                      'max-w-md rounded-md border bg-bg-input/60 px-2 py-0.5 text-xl font-semibold tracking-[-0.01em] text-text-heading outline-none focus:ring-1',
                      nextName
                        ? 'border-border/70 focus:border-border focus:ring-border/60'
                        : 'border-status-error/60 focus:ring-status-error/30',
                    )}
                  />
                ) : isAdmin ? (
                  <Tip label={t('workstreamsPage.editNameHint')}>
                    <button
                      type="button"
                      onClick={startEditing}
                      className="group/title inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md text-left transition-colors hover:bg-bg-hover/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      aria-label={t('workstreamsPage.editNameHint')}
                    >
                      <h1 className="min-w-0 truncate text-xl font-semibold tracking-[-0.01em] text-text-heading">
                        {titleName}
                      </h1>
                      <Pencil
                        size={14}
                        className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
                        aria-hidden
                      />
                    </button>
                  </Tip>
                ) : (
                  <h1 className="min-w-0 truncate text-xl font-semibold tracking-[-0.01em] text-text-heading">
                    {titleName}
                  </h1>
                )}
                {/* Action tag that files tickets into this flow — not the display title. */}
                {tag ? (
                  <TagPill names={tag.name} tone="action" size="sm" title={`#${tag.name.replace(/^#/, '')}`} />
                ) : null}
                {savingMeta ? <Loader2 size={14} className="shrink-0 animate-spin text-text-muted" /> : null}
              </div>
              <div className="flex h-8 shrink-0 items-center gap-2">
                {isAdmin ? (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-8 w-8 px-0 text-text-muted"
                        aria-label={t('workstreamsPage.moreActions')}
                        disabled={togglingEnabled}
                      >
                        {togglingEnabled ? (
                          <Loader2 size={16} className="animate-spin" aria-hidden />
                        ) : (
                          <MoreHorizontal size={16} aria-hidden />
                        )}
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        align="end"
                        sideOffset={4}
                        className="z-50 min-w-[180px] rounded-lg border border-border/60 bg-bg-surface p-1 shadow-overlay"
                      >
                        {editing ? null : (
                          <DropdownMenu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                            onSelect={() => startEditing()}
                          >
                            <Pencil size={14} />
                            {t('workstreamsPage.edit')}
                          </DropdownMenu.Item>
                        )}
                        {editing ? null : <DropdownMenu.Separator className="my-1 h-px bg-border/60" />}
                        {workstream.enabled ? (
                          <DropdownMenu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-status-error outline-none data-[highlighted]:bg-bg-hover"
                            onSelect={() => void toggleEnabled(false)}
                          >
                            <PauseCircle size={14} />
                            {t('workstreamsPage.deactivate')}
                          </DropdownMenu.Item>
                        ) : (
                          <>
                            <DropdownMenu.Item
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                              onSelect={() => void toggleEnabled(true)}
                            >
                              <RotateCcw size={14} />
                              {t('workstreamsPage.activate')}
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
                            <DropdownMenu.Item
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-status-error outline-none data-[highlighted]:bg-bg-hover"
                              onSelect={() => setDeleteOpen(true)}
                            >
                              <Trash2 size={14} />
                              {t('workstreamsPage.delete')}
                            </DropdownMenu.Item>
                          </>
                        )}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                ) : null}
                <Badge
                  variant={workstream.enabled ? 'success' : 'secondary'}
                  className="h-8 px-3 text-xs"
                >
                  {workstream.enabled ? t('workstreamsPage.active') : t('workstreamsPage.deactivated')}
                </Badge>
              </div>
            </div>

            {canEdit ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('workstreamsPage.descriptionPlaceholder')}
                aria-label={t('workstreamsPage.descriptionLabel')}
                disabled={savingMeta}
                rows={2}
                className="w-full max-w-2xl resize-none rounded-md border border-border/70 bg-bg-input/60 px-2 py-1.5 text-sm leading-relaxed text-text-secondary outline-none placeholder:text-text-muted/45 focus:border-border focus:ring-1 focus:ring-border/60"
              />
            ) : workstream.description ? (
              <p className="max-w-3xl truncate text-sm text-text-muted" title={workstream.description}>
                {workstream.description}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-text-muted">
                {t('workstreamsPage.meta.actionTag')}
                {tag ? (
                  <Link
                    to={withNavReveal(tagPath(tag.name, 'open'))}
                    className="inline-flex items-center no-underline"
                  >
                    <Hashtag name={tag.name} category />
                  </Link>
                ) : canEdit ? (
                  <ChoiceSelect
                    aria-label={t('workstreamsPage.meta.bindTag')}
                    placeholder={t('workstreamsPage.meta.bindTag')}
                    triggerClassName="h-7 w-52 text-xs"
                    value=""
                    onValueChange={(value) => void bindTag(value)}
                    disabled={bindingTag}
                    groups={[
                      {
                        items:
                          freeTags.length === 0
                            ? [
                                {
                                  value: '__none__',
                                  label: t('workstreamsPage.meta.noFreeTags'),
                                  kind: 'tag',
                                  disabled: true,
                                },
                              ]
                            : freeTags.map((row) => ({
                                value: row.id,
                                label: row.name,
                                kind: 'tag' as const,
                              })),
                      },
                    ]}
                  />
                ) : (
                  <span className="italic">{t('workstreamsPage.meta.noActionTag')}</span>
                )}
              </span>
              <span className="inline-flex flex-wrap items-center gap-1.5 text-text-muted">
                {t('workstreamsPage.meta.usedIn')}
                {linkedProjects.length === 0 ? (
                  <span className="italic">{t('workstreamsPage.meta.noProjects')}</span>
                ) : (
                  linkedProjects.map((project) => (
                    <Link
                      key={project.id}
                      to={`/folders/${encodeURIComponent(project.id)}`}
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-bg-muted/40 px-1.5 py-0.5 text-text-heading hover:border-border"
                    >
                      <FolderKanban size={12} className="text-text-muted" aria-hidden />
                      {project.name}
                    </Link>
                  ))
                )}
              </span>
              {workstream.stages.some((stage) => (stage.checkup_minutes ?? 0) > 0) ? (
                <Link
                  to="/agenda?view=list&layers=tasks"
                  className="inline-flex items-center gap-1 text-text-muted hover:text-text-heading"
                >
                  <CalendarClock size={12} aria-hidden />
                  {t('workstreamsPage.meta.checkupsOnAgenda')}
                </Link>
              ) : null}
            </div>
          </header>

          {canEdit ? (
            <>
              <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-bg-surface/95 px-3 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-accent/5">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex items-center gap-2 text-sm text-text-primary">
                    <Pencil size={14} className="text-accent" aria-hidden />
                    {t('workstreamsPage.editBar.title')}
                    {dirty ? (
                      <span className="inline-flex items-center gap-1 text-xs text-status-warning">
                        <span className="h-1.5 w-1.5 rounded-full bg-status-warning" aria-hidden />
                        {t('workstreamsPage.editBar.unsaved')}
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted">{t('workstreamsPage.editBar.hint')}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" disabled={savingMeta} onClick={cancelEditing}>
                    {t('workstreamsPage.editBar.cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingMeta || !dirty || !valid}
                    onClick={() => void saveEdits()}
                  >
                    {savingMeta ? (
                      <Loader2 size={13} className="mr-1 animate-spin" />
                    ) : (
                      <Check size={13} className="mr-1" />
                    )}
                    {t('workstreamsPage.editBar.save')}
                  </Button>
                </div>
              </div>
              <WorkstreamStagesCard
                stages={workstream.stages}
                canEdit={canEdit}
                onDraftChange={setStagesDraft}
              />
            </>
          ) : (
            <FlowViewBody
              board={board}
              boardError={boardError}
              onRetry={() => void loadBoard()}
              onChange={setBoard}
              tagName={tag?.name ?? titleName}
            />
          )}

          {deleteOpen ? (
            <ConfirmDeleteDialog
              title={t('workstreamsPage.deleteTitle')}
              itemLabel={t('workstreamsPage.deleteItem')}
              itemName={actionTag ? `#${actionTag}` : titleName}
              impactText={t('workstreamsPage.deleteImpact')}
              isDeleting={deleting}
              onCancel={() => setDeleteOpen(false)}
              onConfirm={() => void confirmDelete()}
            />
          ) : null}

          <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t('workstreamsPage.editBar.discardTitle')}</DialogTitle>
                <DialogDescription>{t('workstreamsPage.editBar.discardBody')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDiscardOpen(false)}>
                  {t('workstreamsPage.editBar.keepEditing')}
                </Button>
                <Button type="button" variant="destructive" onClick={leaveEditing}>
                  {t('workstreamsPage.editBar.discard')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </PageContent>
  )
}

function FlowViewBody({
  board,
  boardError,
  onRetry,
  onChange,
  tagName,
}: {
  board: FlowBoard | null
  boardError: string | null
  onRetry: () => void
  onChange: (board: FlowBoard) => void
  tagName: string
}) {
  const { t } = useTranslation('nav')
  if (boardError) return <ApiErrorBanner message={boardError} onRetry={onRetry} />
  if (!board) return <FlowTicketBoardSkeleton />

  const kinds = KIND_ORDER.filter((kind) => board.stages.some((stage) => stage.kind === kind))
  const byKind = (kind: TicketStageKind) => board.tickets.filter((ticket) => ticket.status === kind).length
  const idle = board.tickets
    .filter((ticket) => ticket.status === 'open' || ticket.status === 'waiting')
    .map((ticket) => ticket.last_message_at)
    .filter((at): at is string => Boolean(at))
    .sort()[0]

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" data-testid="flow-stats">
        <Stat label={t('workstreamsPage.stats.total')} value={board.tickets.length} />
        {kinds.map((kind) => (
          <Stat
            key={kind}
            icon={<StageProgressIcon kind={kind} size={13} />}
            label={t(`workstreamsPage.stages.kinds.${kind}`)}
            value={byKind(kind)}
          />
        ))}
        {idle ? <Stat label={t('workstreamsPage.stats.longestIdle')} value={timeAgo(idle, t)} /> : null}
      </div>
      {board.tickets.length === 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-text-muted">
          <MessageSquare size={14} aria-hidden />
          {t('workstreamsPage.board.empty', { tag: tagName })}
          <Link to={inboxPath('all')} className="font-medium text-accent hover:underline">
            {t('workstreamsPage.board.openCommunication')}
          </Link>
        </p>
      ) : null}
      <FlowTicketBoard board={board} canMove onChange={onChange} />
    </section>
  )
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-bg-elevated/60 px-2.5 py-1 text-xs">
      {icon}
      <span className="text-text-muted">{label}</span>
      <span className="font-semibold tabular-nums text-text-heading">{value}</span>
    </span>
  )
}
