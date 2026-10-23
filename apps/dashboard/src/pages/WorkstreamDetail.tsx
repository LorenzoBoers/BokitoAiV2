import { Spinner } from '../components/ui/spinner'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { toastMovedToBin } from '../lib/bin-toast'
import { MoreHorizontal, Pencil, Settings, Trash2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { PageContent } from '../components/layout/PageContent'
import { OpenInGridButton } from '../components/org/OpenInGridButton'
import { Button } from '../components/ui/button'
import { PageHeader } from '../components/ui/page-header'
import { Switch } from '../components/ui/switch'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import { FlowHeaderSkeleton } from '../components/ui/skeleton'
import { ChoiceSelect } from '../components/ui/ChoiceSelect'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import { NameEdit } from '../components/ui/NameEdit'
import { LabelMarkDialog } from '../components/ui/LabelMark'
import { TagPill } from '../components/ui/TagPill'
import { Tip } from '../components/ui/Tip'
import { FlowRecipe } from '../components/flows/FlowRecipe'
import { FlowSchemaEditor } from '../components/flows/FlowSchemaEditor'
import { FlowStageEntryControl } from '../components/flows/FlowStageEntryControl'
import { FlowTicketBoard, FlowTicketBoardSkeleton } from '../components/flows/FlowTicketBoard'
import { StageProgressIcon } from '../components/flows/StageProgressIcon'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { flowActionTag, flowTitle } from '../lib/flow-title'
import { useEntityRefresh } from '../lib/live-store'
import { listSignalTags, updateSignalTag, type LabelColor, type SignalTag } from '../lib/signals-api'
import type { FlowBoard, TicketStage, TicketStageKind } from '../lib/tickets-api'
import { listTeams, type Team } from '../lib/teams-api'
import { timeAgo } from '../lib/time-ago'
import {
  deleteWorkstream,
  getWorkstream,
  getWorkstreamBoard,
  patchWorkstream,
  type FlowAutonomy,
  type WorkstreamDetail as WorkstreamDetailPayload,
} from '../lib/flows-api'

const CalendarClock = ENTITY_ICONS.agenda
const FlowIcon = ENTITY_ICONS.flow

const KIND_ORDER: TicketStageKind[] = ['open', 'waiting', 'done', 'closed']

function countByStage(tickets: FlowBoard['tickets']): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const ticket of tickets) counts[ticket.stage_key] = (counts[ticket.stage_key] ?? 0) + 1
  return counts
}

/**
 * A flow: the stage pipeline of one action tag. The live ticket board is the
 * page; admins rename stages and add one from the column row. Lanes are
 * folders that share the flow's action tag.
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [freeTags, setFreeTags] = useState<SignalTag[]>([])
  const [bindingTag, setBindingTag] = useState(false)
  const [savingReview, setSavingReview] = useState(false)
  const [departments, setDepartments] = useState<Team[]>([])

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
    if (!token) return
    void listTeams(token)
      .then((rows) => setDepartments(rows.filter((row) => !row.system && !row.root)))
      .catch(() => setDepartments([]))
  }, [token])

  const saveDepartment = async (next: string) => {
    if (!workstream || !tag || !token) return
    setSavingReview(true)
    try {
      await updateSignalTag(token, tag.id, { department_id: next || null })
      const departmentId = next || ''
      setWorkstream((prev) =>
        prev
          ? {
              ...prev,
              tags: (prev.tags ?? []).map((row) =>
                row.id === tag.id ? { ...row, department_id: departmentId } : row,
              ),
            }
          : prev,
      )
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.saveError')))
    } finally {
      setSavingReview(false)
    }
  }

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

  const saveAutonomy = async (next: FlowAutonomy) => {
    if (!workstream) return
    setSavingReview(true)
    try {
      const updated = await patchWorkstream(workstream.id, { autonomy: next })
      setWorkstream((prev) => (prev ? { ...prev, ...updated } : prev))
      if (updated.pending_change_id) toast.message(t('workstreamsPage.recipe.autonomyLooserInGovern'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.saveError')))
    } finally {
      setSavingReview(false)
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

  const confirmDelete = async () => {
    if (!workstream) return
    setDeleting(true)
    try {
      await deleteWorkstream(workstream.id)
      toastMovedToBin(t('workstreamsPage.deleted'), navigate)
      navigate('/flows')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.deleteError')))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <PageContent width="full" className="space-y-4 py-1">
      {loading ? (
        <FlowHeaderSkeleton />
      ) : error || !workstream ? (
        <ApiErrorBanner message={error ?? t('workstreamsPage.notFound')} onRetry={() => void load()} />
      ) : (
        <>
          <PageHeader
            className="mb-0"
            back={{ to: '/flows', label: t('workstreamsPage.back') }}
            title={
              <span className="flex min-w-0 items-center gap-2.5">
                <FlowIcon size={24} className="shrink-0 text-text-muted" aria-hidden />
                <Tip label={isAdmin ? t('workstreamsPage.editNameHint') : undefined}>
                  <NameEdit
                    heading="span"
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
                    title={isAdmin ? t('workstreamsPage.mark.title', { defaultValue: 'Label' }) : tag.name.replace(/^#/, '')}
                    onClick={isAdmin ? () => setMarkOpen(true) : undefined}
                  />
                ) : null}
                {savingMeta ? <Spinner size="md" className="text-text-muted" /> : null}
              </span>
            }
            subtitle={
              workstream.stages.some((stage) => (stage.checkup_minutes ?? 0) > 0) ? (
                <Link
                  to="/agenda?view=list&layers=tasks"
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-heading"
                >
                  <CalendarClock size={12} aria-hidden />
                  {t('workstreamsPage.meta.checkupsOnAgenda')}
                </Link>
              ) : undefined
            }
            actions={
              <>
                <OpenInGridButton kind="flow" id={workstream.id} />
                {isAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="gap-1.5 px-2.5"
                    onClick={() => setEditorOpen(true)}
                  >
                    <Pencil size={14} aria-hidden />
                    {t('workstreamsPage.schema.edit')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="px-0 text-text-muted"
                  aria-label={t('workstreamsPage.openSettings')}
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings size={16} aria-hidden />
                </Button>
              </>
            }
            primaryAction={
              isAdmin ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="px-0 text-text-muted"
                      aria-label={t('workstreamsPage.moreActions')}
                    >
                      <MoreHorizontal size={16} aria-hidden />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={4}
                      className="z-50 min-w-[180px] rounded-lg border border-border bg-bg-surface p-1 shadow-overlay"
                    >
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-status-error outline-none data-[highlighted]:bg-bg-hover"
                        onSelect={() => setDeleteOpen(true)}
                      >
                        <Trash2 size={14} />
                        {t('workstreamsPage.delete')}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : undefined
            }
          />

          <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
            <DialogContent className="flex h-[min(960px,94vh)] w-[calc(100%-1.5rem)] max-w-[1440px] flex-col gap-0 overflow-hidden p-0">
              <FlowSchemaEditor
                workstreamId={workstream.id}
                stages={workstream.stages}
                initial={workstream.flow_graph ?? { nodes: [], edges: [], errors: [] }}
                counts={board ? countByStage(board.tickets) : undefined}
                onSaved={(row) => setWorkstream((prev) => (prev ? { ...prev, ...row } : prev))}
                onClose={() => setEditorOpen(false)}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogContent className="max-h-[min(880px,92vh)] w-[calc(100%-2rem)] max-w-xl gap-0 overflow-hidden p-0">
              <DialogHeader className="border-b border-border px-5 py-4 pr-14 text-left">
                <DialogTitle>{t('workstreamsPage.settingsTitle')}</DialogTitle>
                <DialogDescription>{t('workstreamsPage.settingsHint')}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[min(760px,calc(92vh-5.5rem))] space-y-5 overflow-y-auto px-5 py-4">
                <FlowRecipe
                  flow={workstream}
                  canEdit={isAdmin}
                  onSaved={(updated) => {
                    if (updated.direct !== workstream.direct) void loadBoard()
                    setWorkstream((prev) => (prev ? { ...prev, ...updated } : prev))
                  }}
                />

                {isAdmin || workstream.description ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="flow-description">{t('workstreamsPage.descriptionLabel')}</Label>
                    {isAdmin ? (
                      <Textarea
                        id="flow-description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        onBlur={() => void saveDescription()}
                        placeholder={t('workstreamsPage.descriptionPlaceholder')}
                        aria-label={t('workstreamsPage.descriptionLabel')}
                        disabled={savingMeta}
                        rows={3}
                        className="min-h-16"
                      />
                    ) : (
                      <p className="text-sm text-text-secondary">{workstream.description}</p>
                    )}
                  </div>
                ) : null}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="flow-autonomy">{t('workstreamsPage.recipe.autonomy')}</Label>
                  <Select
                    value={workstream.autonomy || 'inherit'}
                    disabled={!isAdmin || savingReview}
                    onValueChange={(value) =>
                      void saveAutonomy((value === 'inherit' ? '' : value) as FlowAutonomy)
                    }
                  >
                    <SelectTrigger id="flow-autonomy" className="h-8 text-sm" data-testid="flow-autonomy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['inherit', 'manual', 'assisted', 'autonomous'] as const).map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {t(`workstreamsPage.recipe.autonomyLevel.${mode}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-text-muted">{t('workstreamsPage.recipe.autonomyLooserInGovern')}</p>
                </div>

                {departments.length > 0 && tag ? (
                  <div className="flex flex-col gap-1.5" data-testid="flow-department">
                    <Label>{t('workstreamsPage.departmentLabel')}</Label>
                    <ChoiceSelect
                      aria-label={t('workstreamsPage.departmentLabel')}
                      value={tag.department_id || workstream.department_id || '__none__'}
                      onValueChange={(value) => void saveDepartment(value === '__none__' ? '' : value)}
                      disabled={!isAdmin || savingReview}
                      groups={[
                        {
                          items: [
                            {
                              value: '__none__',
                              label: t('workstreamsPage.departmentNone' /* design-system-ignore: waarde, label of keuze, geen lege lijst */),
                              kind: 'team',
                            },
                            ...departments.map((dept) => ({
                              value: dept.id,
                              label: dept.name,
                              kind: 'team' as const,
                              team: dept,
                            })),
                          ],
                        },
                      ]}
                    />
                  </div>
                ) : null}

                <FlowStageEntryControl
                  flow={workstream}
                  canEdit={isAdmin}
                  onSaved={(updated) => setWorkstream((prev) => (prev ? { ...prev, ...updated } : prev))}
                />

                {!tag && isAdmin ? (
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('workstreamsPage.meta.bindTag')}</Label>
                    <ChoiceSelect
                      aria-label={t('workstreamsPage.meta.bindTag')}
                      placeholder={t('workstreamsPage.meta.bindTag')}
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
                                    label: t('workstreamsPage.meta.noFreeTags' /* design-system-ignore: waarde, label of keuze, geen lege lijst */),
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
                  </div>
                ) : !tag ? (
                  <p className="text-sm italic text-text-muted">{t('workstreamsPage.meta.noActionTag' /* design-system-ignore: waarde, label of keuze, geen lege lijst */)}</p>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>

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
            <ConfirmDialog
              open
              destructive
              title={t('workstreamsPage.deleteTitle')}
              typeToConfirm={actionTag || titleName}
              description={t('workstreamsPage.deleteImpact')}
              busy={deleting}
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
  const [showEmptyLanes, setShowEmptyLanes] = useState(false)
  if (boardError) return <ApiErrorBanner message={boardError} onRetry={onRetry} />
  if (!board) return <FlowTicketBoardSkeleton />

  const kinds = KIND_ORDER.filter((kind) => board.stages.some((stage) => stage.kind === kind))
  const byKind = (kind: TicketStageKind) => board.tickets.filter((ticket) => ticket.status === kind).length
  const idle = board.tickets
    .filter((ticket) => ticket.status === 'open' || ticket.status === 'waiting')
    .map((ticket) => ticket.last_message_at)
    .filter((at): at is string => Boolean(at))
    .sort()[0]
  const emptyLaneCount = board.lanes.filter(
    (lane) => !board.tickets.some((ticket) => (ticket.project_id ?? null) === lane.id),
  ).length

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
        {emptyLaneCount > 0 && board.tickets.length > 0 ? (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-text-muted">
            <Switch
              checked={showEmptyLanes}
              onCheckedChange={setShowEmptyLanes}
              aria-label={t('workstreamsPage.board.showEmptyLanes')}
            />
            <span>{t('workstreamsPage.board.showEmptyLanes')}</span>
          </label>
        ) : null}
      </div>
      <FlowTicketBoard
        board={board}
        canMove
        onChange={onChange}
        canEditStages={canEditStages}
        editStageKey={editStageKey}
        onSaveStages={onSaveStages}
        showEmptyLanes={showEmptyLanes}
        actionTag={tagName}
      />
    </section>
  )
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-elevated/60 px-2.5 py-1 text-xs">
      {icon}
      <span className="text-text-muted">{label}</span>
      <span className="font-semibold tabular-nums text-text-heading">{value}</span>
    </span>
  )
}
