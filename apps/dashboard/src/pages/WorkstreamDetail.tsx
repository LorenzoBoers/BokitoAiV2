import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toastMovedToBin } from '../lib/bin-toast'
import { ArrowLeft, Loader2, MoreHorizontal, PauseCircle, RotateCcw, Trash2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { PageContent } from '../components/layout/PageContent'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ChoiceSelect } from '../components/ui/ChoiceSelect'
import { NameEdit } from '../components/ui/NameEdit'
import { LabelMarkDialog } from '../components/ui/LabelMark'
import { TagPill } from '../components/ui/TagPill'
import { Tip } from '../components/ui/Tip'
import { FlowTicketBoard, FlowTicketBoardSkeleton } from '../components/workstreams/FlowTicketBoard'
import { StageProgressIcon } from '../components/workstreams/StageProgressIcon'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { flowActionTag, flowTitle } from '../lib/flow-title'
import { useEntityRefresh } from '../lib/live-store'
import { inboxPath } from '../lib/messages-paths'
import { listSignalTags, updateSignalTag, type LabelColor, type SignalTag } from '../lib/signals-api'
import type { FlowBoard, TicketStage, TicketStageKind } from '../lib/tickets-api'
import { timeAgo } from '../lib/time-ago'
import {
  deleteWorkstream,
  getWorkstream,
  getWorkstreamBoard,
  patchWorkstream,
  type WorkstreamDetail as WorkstreamDetailPayload,
} from '../lib/workstreams-api'

const CalendarClock = ENTITY_ICONS.agenda
const FlowIcon = ENTITY_ICONS.flow
const MessageSquare = ENTITY_ICONS.conversation

const KIND_ORDER: TicketStageKind[] = ['open', 'waiting', 'done', 'closed']

/**
 * A flow: the stage pipeline of one action tag. The live ticket board is the
 * page; admins rename stages and add one from the column row.
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
  const [board, setBoard] = useState<FlowBoard | null>(null)
  const [boardError, setBoardError] = useState<string | null>(null)

  const [searchParams, setSearchParams] = useSearchParams()
  const [editStageKey, setEditStageKey] = useState<string | null>(null)
  const [titleEditing, setTitleEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [markOpen, setMarkOpen] = useState(false)
  const [savingMark, setSavingMark] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [freeTags, setFreeTags] = useState<SignalTag[]>([])
  const [bindingTag, setBindingTag] = useState(false)

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
      const detail = await getWorkstream(workstreamId)
      setWorkstream(detail)
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

  useEffect(() => {
    if (!isAdmin || tag || !token) return
    void listSignalTags(token)
      .then((rows) => setFreeTags(rows.filter((row) => !row.workstreamId)))
      .catch(() => setFreeTags([]))
  }, [isAdmin, tag, token])

  useEffect(() => {
    if (!workstream) return
    const wantsFields = searchParams.get('fields') === '1'
    const legacyEdit = searchParams.get('edit') === '1'
    if (!wantsFields && !legacyEdit) return
    if (wantsFields) {
      const first = workstream.stages.find((stage) => stage.kind === 'open') ?? workstream.stages[0]
      if (first) setEditStageKey(first.key)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('fields')
    next.delete('edit')
    setSearchParams(next, { replace: true })
  }, [workstream, searchParams, setSearchParams])

  const saveName = async () => {
    if (!workstream) return
    const next = name.trim()
    if (!next || next === titleName) {
      setName(titleName)
      setTitleEditing(false)
      return
    }
    setSavingMeta(true)
    try {
      await patchWorkstream(workstream.id, { name: next.slice(0, 120) })
      const fresh = await getWorkstream(workstream.id)
      setWorkstream(fresh)
      setName(flowTitle(fresh))
      setTitleEditing(false)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.saveError')))
    } finally {
      setSavingMeta(false)
    }
  }

  const saveDescription = async () => {
    if (!workstream) return
    const next = description.trim()
    if (next === (workstream.description ?? '')) return
    setSavingMeta(true)
    try {
      const updated = await patchWorkstream(workstream.id, { description: next })
      setWorkstream((prev) => (prev ? { ...prev, ...updated, description: next } : prev))
    } catch (err) {
      setDescription(workstream.description ?? '')
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.saveError')))
    } finally {
      setSavingMeta(false)
    }
  }

  const saveStages = async (stages: TicketStage[]) => {
    if (!workstream) return
    setSavingMeta(true)
    try {
      await patchWorkstream(workstream.id, { stages })
      const fresh = await getWorkstream(workstream.id)
      setWorkstream(fresh)
      void loadBoard()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.stages.saveError')))
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
                <FlowIcon size={24} className="shrink-0 text-text-muted" aria-hidden />
                <Tip label={isAdmin ? t('workstreamsPage.editNameHint') : undefined}>
                  <NameEdit
                    value={titleEditing ? name : titleName}
                    canEdit={isAdmin}
                    editing={titleEditing}
                    disabled={savingMeta}
                    invalid={titleEditing && !name.trim()}
                    label={t('workstreamsPage.editNameHint')}
                    onStart={() => {
                      setName(titleName)
                      setTitleEditing(true)
                    }}
                    onChange={setName}
                    onCommit={() => void saveName()}
                    onCancel={() => {
                      setName(titleName)
                      setTitleEditing(false)
                    }}
                  />
                </Tip>
                {/* Action tag that files tickets into this flow — not the display title. */}
                {tag ? (
                  <TagPill
                    names={tag.name}
                    tone="action"
                    size="md"
                    color={(tag.color || '') as LabelColor}
                    icon={tag.icon}
                    title={isAdmin ? t('workstreamsPage.mark.title', { defaultValue: 'Label' }) : `#${tag.name.replace(/^#/, '')}`}
                    onClick={isAdmin ? () => setMarkOpen(true) : undefined}
                  />
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

            {isAdmin ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => void saveDescription()}
                placeholder={t('workstreamsPage.descriptionPlaceholder')}
                aria-label={t('workstreamsPage.descriptionLabel')}
                disabled={savingMeta}
                rows={workstream.description || description ? 2 : 1}
                className="w-full max-w-2xl resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-sm leading-relaxed text-text-secondary outline-none placeholder:text-text-muted/45 hover:border-border/60 focus:border-border focus:bg-bg-input/60 focus:ring-1 focus:ring-border/60"
              />
            ) : workstream.description ? (
              <p className="max-w-3xl truncate text-sm text-text-muted" title={workstream.description}>
                {workstream.description}
              </p>
            ) : null}

            {!tag || workstream.stages.some((stage) => (stage.checkup_minutes ?? 0) > 0) ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              {!tag && isAdmin ? (
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
              ) : !tag ? (
                <span className="italic text-text-muted">{t('workstreamsPage.meta.noActionTag')}</span>
              ) : null}
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
            ) : null}
          </header>

          <FlowViewBody
            board={board}
            boardError={boardError}
            onRetry={() => void loadBoard()}
            onChange={setBoard}
            tagName={tag?.name ?? titleName}
            canEditStages={isAdmin}
            editStageKey={editStageKey}
            onSaveStages={saveStages}
          />

          {tag ? (
            <LabelMarkDialog
              open={markOpen}
              onOpenChange={setMarkOpen}
              name={tag.name}
              color={(tag.color || '') as LabelColor}
              icon={tag.icon || ''}
              saving={savingMark}
              onSave={(next) => {
                if (!token) return
                setSavingMark(true)
                void updateSignalTag(token, tag.id, next)
                  .then(() => {
                    setMarkOpen(false)
                    return load()
                  })
                  .catch((err) => {
                    toast.error(formatApiErrorMessage(err, t('workstreamsPage.mark.saveError', { defaultValue: 'Could not save the label' })))
                  })
                  .finally(() => setSavingMark(false))
              }}
            />
          ) : null}

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
  canEditStages,
  editStageKey,
  onSaveStages,
}: {
  board: FlowBoard | null
  boardError: string | null
  onRetry: () => void
  onChange: (board: FlowBoard) => void
  tagName: string
  canEditStages: boolean
  editStageKey: string | null
  onSaveStages: (stages: TicketStage[]) => Promise<void>
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
      <FlowTicketBoard
        board={board}
        canMove
        onChange={onChange}
        canEditStages={canEditStages}
        editStageKey={editStageKey}
        onSaveStages={onSaveStages}
      />
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
