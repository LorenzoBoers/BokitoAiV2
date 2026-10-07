import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  checkupLabel,
  stageLabel,
  type TicketStage,
  type TicketStageField,
  type TicketStageFieldType,
  type TicketStageKind,
  type TicketStageOwner,
} from '../../lib/tickets-api'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import { listAgents } from '../../lib/agents-api'
import { StageProgressIcon } from './StageProgressIcon'
import { cn } from '../../lib/utils'

const KINDS: TicketStageKind[] = ['open', 'waiting', 'done', 'closed']
const FIELD_TYPES: TicketStageFieldType[] = ['text', 'textarea', 'number', 'enum']
const MAX_FIELDS = 8
const MAX_ENUM_OPTIONS = 20

/** Phase column width bounds — grow to fill the row until max; overflow scrolls beyond min. */
const PHASE_MIN_PX = 220
const PHASE_MAX_PX = 320

type DraftStage = TicketStage & { dragId: string }

function normalizeFields(fields: TicketStageField[] | undefined): TicketStageField[] {
  return (fields ?? []).map((field) => ({
    key: field.key || '',
    name: field.name || '',
    type: FIELD_TYPES.includes(field.type) ? field.type : 'text',
    required: Boolean(field.required),
    options: field.type === 'enum' ? [...(field.options ?? [])] : undefined,
  }))
}

function normalizeStage(stage: TicketStage): TicketStage {
  return {
    ...stage,
    auto_close_conversation: stage.kind === 'done' ? Boolean(stage.auto_close_conversation) : false,
    fields: normalizeFields(stage.fields),
    owner: stage.owner?.id ? { kind: stage.owner.kind, id: stage.owner.id } : null,
    checkup_minutes: stage.kind === 'done' ? 0 : Math.max(0, stage.checkup_minutes ?? 0),
  }
}

export type StageOwnerOption = { value: string; label: string; group: 'user' | 'agent' | 'team' }

const CHECKUP_PRESETS = [0, 240, 1440, 2880, 10080]

function ownerValue(owner: TicketStageOwner | null | undefined): string {
  return owner?.id ? `${owner.kind}:${owner.id}` : 'keep'
}

function parseOwnerValue(value: string): TicketStageOwner | null {
  const [kind, id] = value.split(':')
  if (!id || (kind !== 'user' && kind !== 'agent' && kind !== 'team')) return null
  return { kind, id }
}

function StageOwnerFields({
  stage,
  owners,
  canEdit,
  onUpdate,
}: {
  stage: TicketStage
  owners: StageOwnerOption[]
  canEdit: boolean
  onUpdate: (patch: Partial<TicketStage>) => void
}) {
  const { t } = useTranslation('nav')
  const minutes = stage.checkup_minutes ?? 0
  const presets = CHECKUP_PRESETS.includes(minutes) ? CHECKUP_PRESETS : [...CHECKUP_PRESETS, minutes]
  const groups: StageOwnerOption['group'][] = ['user', 'agent', 'team']
  return (
    <div className="space-y-2 rounded-lg border border-border/50 bg-bg-muted/20 p-2.5">
      <div className="space-y-1">
        <Label className="text-xs text-text-muted">{t('workstreamsPage.stages.owner')}</Label>
        <Select
          value={ownerValue(stage.owner)}
          disabled={!canEdit}
          onValueChange={(value) => onUpdate({ owner: parseOwnerValue(value) })}
        >
          <SelectTrigger className="h-8 text-xs" aria-label={t('workstreamsPage.stages.owner')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">{t('workstreamsPage.stages.ownerKeep')}</SelectItem>
            {groups.map((group) => {
              const rows = owners.filter((row) => row.group === group)
              if (rows.length === 0) return null
              return (
                <SelectGroup key={group}>
                  <SelectSeparator />
                  <SelectLabel>{t(`workstreamsPage.stages.ownerGroups.${group}`)}</SelectLabel>
                  {rows.map((row) => (
                    <SelectItem key={row.value} value={row.value}>
                      {row.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )
            })}
            {stage.owner?.id && !owners.some((row) => row.value === ownerValue(stage.owner)) ? (
              <SelectItem value={ownerValue(stage.owner)}>{t('workstreamsPage.stages.ownerUnknown')}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>
      {stage.kind !== 'done' ? (
        <div className="space-y-1">
          <Label className="text-xs text-text-muted">{t('workstreamsPage.stages.checkup')}</Label>
          <Select
            value={String(minutes)}
            disabled={!canEdit}
            onValueChange={(value) => onUpdate({ checkup_minutes: Number(value) })}
          >
            <SelectTrigger className="h-8 text-xs" aria-label={t('workstreamsPage.stages.checkup')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presets.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {checkupLabel(value, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-2xs leading-snug text-text-muted">{t('workstreamsPage.stages.checkupHint')}</p>
        </div>
      ) : null}
    </div>
  )
}

function newDragId(): string {
  return `stage-${crypto.randomUUID()}`
}

function stagesEqual(a: TicketStage[], b: TicketStage[]): boolean {
  return JSON.stringify(a.map(normalizeStage)) === JSON.stringify(b.map(normalizeStage))
}

function SortablePhaseCard({
  stage,
  index,
  canEdit,
  canRemove,
  owners,
  onUpdate,
  onRemove,
}: {
  stage: DraftStage
  index: number
  canEdit: boolean
  canRemove: boolean
  owners: StageOwnerOption[]
  onUpdate: (patch: Partial<TicketStage>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('nav')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.dragId,
    disabled: !canEdit,
  })
  const fieldCount = stage.fields?.length ?? 0
  const [fieldsOpen, setFieldsOpen] = useState(false)

  return (
    <article
      ref={setNodeRef}
      style={{
        flex: `1 0 ${PHASE_MIN_PX}px`,
        minWidth: PHASE_MIN_PX,
        maxWidth: PHASE_MAX_PX,
        width: `clamp(${PHASE_MIN_PX}px, 22vw, ${PHASE_MAX_PX}px)`,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'flex shrink-0 flex-col rounded-xl border border-border/70 bg-bg-elevated/90 shadow-sm',
        isDragging && 'z-20 border-accent/50 opacity-95 shadow-md',
      )}
    >
      <header className="flex items-center gap-1.5 border-b border-border/60 px-2 py-2.5 sm:px-3">
        {canEdit ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="shrink-0 cursor-grab touch-none rounded-md p-1 text-text-muted hover:bg-bg-muted/70 hover:text-text-primary active:cursor-grabbing"
            aria-label={t('workstreamsPage.stages.dragAria', {
              defaultValue: 'Drag to reorder',
              name: stage.name || String(index + 1),
            })}
          >
            <GripVertical size={15} />
          </button>
        ) : null}
        <StageProgressIcon kind={stage.kind} size={18} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-xs font-semibold tabular-nums text-text-muted">
            {index + 1}.
          </span>
          {canEdit ? (
            <input
              value={stage.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              placeholder={t('workstreamsPage.stages.namePlaceholder')}
              aria-label={t('workstreamsPage.stages.namePlaceholder')}
              title={t('workstreamsPage.stages.editNameHint', {
                defaultValue: 'Click to edit',
              })}
              className="min-w-0 flex-1 cursor-text rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-semibold uppercase tracking-[0.03em] text-text-heading outline-none transition-colors placeholder:normal-case placeholder:tracking-normal placeholder:text-text-muted/50 hover:border-border/70 hover:bg-bg-input/90 focus:border-border focus:bg-bg-input focus:ring-1 focus:ring-border/60"
            />
          ) : (
            <p className="truncate text-xs font-semibold uppercase tracking-[0.03em] text-text-heading">
              {stage.name.trim() || t('workstreamsPage.stages.namePlaceholder')}
            </p>
          )}
        </div>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 p-0 text-text-muted hover:text-status-error"
            disabled={!canRemove}
            aria-label={t('workstreamsPage.stages.remove')}
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </Button>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="space-y-1.5 rounded-lg border border-border/50 bg-bg-muted/20 p-2.5">
          <Label className="text-xs text-text-muted">{t('workstreamsPage.stages.kind')}</Label>
          <Select
            value={stage.kind}
            onValueChange={(value) => onUpdate({ kind: value as TicketStageKind })}
            disabled={!canEdit}
          >
            <SelectTrigger className="h-8 text-xs" aria-label={t('workstreamsPage.stages.kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`workstreamsPage.stages.kinds.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <StageOwnerFields stage={stage} owners={owners} canEdit={canEdit} onUpdate={onUpdate} />

        {stage.kind === 'done' ? (
          <label className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-bg-muted/20 px-2.5 py-2">
            <Switch
              checked={Boolean(stage.auto_close_conversation)}
              disabled={!canEdit}
              onCheckedChange={(checked) => onUpdate({ auto_close_conversation: checked })}
              aria-label={t('workstreamsPage.stages.autoClose')}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-text-primary">
                {t('workstreamsPage.stages.autoClose')}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-text-muted">
                {t('workstreamsPage.stages.autoCloseHint')}
              </span>
            </span>
          </label>
        ) : null}

        <div className="space-y-2 rounded-lg border border-border/50 bg-bg-muted/20 p-2.5">
          <button
            type="button"
            onClick={() => setFieldsOpen((open) => !open)}
            aria-expanded={fieldsOpen}
            className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-text-muted hover:text-text-primary"
          >
            <ChevronDown
              size={12}
              className={cn('shrink-0 transition-transform', !fieldsOpen && '-rotate-90')}
              aria-hidden
            />
            <span>{t('workstreamsPage.stages.fields')}</span>
            {fieldCount > 0 ? (
              <span className="ml-auto rounded bg-bg-muted px-1.5 text-2xs tabular-nums text-text-secondary">
                {fieldCount}
              </span>
            ) : null}
          </button>
          {fieldsOpen ? (
            <p className="text-2xs leading-snug text-text-muted">{t('workstreamsPage.stages.fieldsHint')}</p>
          ) : null}
          {fieldsOpen ? (stage.fields ?? []).map((field, fieldIndex) => (
            <div
              key={`${stage.dragId}-field-${fieldIndex}`}
              className="space-y-1.5 rounded-md border border-border/40 bg-bg-surface/80 p-2"
            >
              <div className="flex items-center gap-1">
                <input
                  value={field.name}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const fields = [...(stage.fields ?? [])]
                    fields[fieldIndex] = { ...field, name: e.target.value }
                    onUpdate({ fields })
                  }}
                  placeholder={t('workstreamsPage.stages.fieldName')}
                  aria-label={t('workstreamsPage.stages.fieldName')}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-bg-input/80 px-2 text-xs"
                />
                {canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 p-0 text-text-muted hover:text-status-error"
                    aria-label={t('workstreamsPage.stages.fieldRemove')}
                    onClick={() => {
                      const fields = (stage.fields ?? []).filter((_, i) => i !== fieldIndex)
                      onUpdate({ fields })
                    }}
                  >
                    <Trash2 size={12} />
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={field.type}
                  disabled={!canEdit}
                  onValueChange={(value) => {
                    const nextType = value as TicketStageFieldType
                    const fields = [...(stage.fields ?? [])]
                    fields[fieldIndex] = {
                      ...field,
                      type: nextType,
                      options:
                        nextType === 'enum'
                          ? field.options && field.options.length > 0
                            ? field.options
                            : ['', '']
                          : undefined,
                    }
                    onUpdate({ fields })
                  }}
                >
                  <SelectTrigger
                    className="h-7 min-w-0 flex-1 text-2xs"
                    aria-label={t('workstreamsPage.stages.fieldType')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`workstreamsPage.stages.fieldTypes.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex shrink-0 items-center gap-1.5 text-2xs text-text-muted">
                  <Switch
                    checked={Boolean(field.required)}
                    disabled={!canEdit}
                    onCheckedChange={(checked) => {
                      const fields = [...(stage.fields ?? [])]
                      fields[fieldIndex] = { ...field, required: checked }
                      onUpdate({ fields })
                    }}
                    aria-label={t('workstreamsPage.stages.fieldRequired')}
                    className="scale-75"
                  />
                  {t('workstreamsPage.stages.fieldRequired')}
                </label>
              </div>
              {field.type === 'enum' ? (
                <div className="space-y-1.5 rounded-md border border-dashed border-border/50 p-1.5">
                  <p className="text-2xs font-medium text-text-muted">
                    {t('workstreamsPage.stages.fieldOptions')}
                  </p>
                  {(field.options ?? ['', '']).map((option, optionIndex) => (
                    <div key={`${stage.dragId}-opt-${fieldIndex}-${optionIndex}`} className="flex items-center gap-1">
                      <input
                        value={option}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const options = [...(field.options ?? [])]
                          options[optionIndex] = e.target.value
                          const fields = [...(stage.fields ?? [])]
                          fields[fieldIndex] = { ...field, options }
                          onUpdate({ fields })
                        }}
                        placeholder={t('workstreamsPage.stages.fieldOptionPlaceholder')}
                        aria-label={t('workstreamsPage.stages.fieldOptionPlaceholder')}
                        className="h-7 min-w-0 flex-1 rounded-md border border-border/50 bg-bg-input/80 px-2 text-2xs"
                      />
                      {canEdit && (field.options?.length ?? 0) > 2 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 p-0 text-text-muted hover:text-status-error"
                          aria-label={t('workstreamsPage.stages.fieldOptionRemove')}
                          onClick={() => {
                            const options = (field.options ?? []).filter((_, i) => i !== optionIndex)
                            const fields = [...(stage.fields ?? [])]
                            fields[fieldIndex] = { ...field, options }
                            onUpdate({ fields })
                          }}
                        >
                          <Trash2 size={11} />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {canEdit && (field.options?.length ?? 0) < MAX_ENUM_OPTIONS ? (
                    <button
                      type="button"
                      onClick={() => {
                        const fields = [...(stage.fields ?? [])]
                        fields[fieldIndex] = {
                          ...field,
                          options: [...(field.options ?? []), ''],
                        }
                        onUpdate({ fields })
                      }}
                      className="flex w-full items-center justify-center gap-1 rounded-md px-1 py-1 text-2xs text-text-muted hover:text-text-primary"
                    >
                      <Plus size={11} />
                      {t('workstreamsPage.stages.fieldOptionAdd')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )) : null}
          {fieldsOpen && canEdit && fieldCount < MAX_FIELDS ? (
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  fields: [
                    ...(stage.fields ?? []),
                    { key: '', name: '', type: 'text', required: false },
                  ],
                })
              }
              className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border/60 px-2 py-1.5 text-2xs text-text-muted hover:border-accent/40 hover:text-text-primary"
            >
              <Plus size={12} />
              {t('workstreamsPage.stages.fieldAdd')}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export type StagesDraft = { dirty: boolean; valid: boolean; stages: TicketStage[] }

/** Stage editor working on a local draft; the page saves or discards it. */
export function WorkstreamStagesCard({
  stages,
  canEdit,
  onDraftChange,
}: {
  stages: TicketStage[]
  canEdit: boolean
  onDraftChange?: (draft: StagesDraft) => void
}) {
  const { t } = useTranslation('nav')
  const stagesKey = JSON.stringify(stages)
  const shown = useMemo(
    () => (JSON.parse(stagesKey) as TicketStage[]).map((s) => normalizeStage({ ...s, name: stageLabel(s, t) })),
    [stagesKey, t],
  )
  const [draft, setDraft] = useState<DraftStage[]>(() =>
    shown.map((s) => ({ ...s, dragId: s.key || newDragId() })),
  )
  const boardRef = useRef<HTMLDivElement>(null)
  const { members } = useMembers()
  const { teams } = useTeams()
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    let cancelled = false
    listAgents()
      .then((rows) => {
        if (!cancelled) setAgents(rows.map((row) => ({ id: row.id, name: row.name })))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const owners = useMemo<StageOwnerOption[]>(
    () => [
      ...members
        .filter((m) => m.uuid)
        .map((m) => ({ value: `user:${m.uuid}`, label: m.name || m.email, group: 'user' as const })),
      ...agents.map((a) => ({ value: `agent:${a.id}`, label: a.name, group: 'agent' as const })),
      ...teams.map((team) => ({ value: `team:${team.id}`, label: team.name, group: 'team' as const })),
    ],
    [members, agents, teams],
  )

  useEffect(() => {
    setDraft((prev) => {
      const prevByKey = new Map(prev.filter((s) => s.key).map((s) => [s.key, s.dragId]))
      return shown.map((s) => ({
        ...s,
        dragId: s.key ? prevByKey.get(s.key) || s.key : newDragId(),
      }))
    })
  }, [shown])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const plainDraft = useMemo(
    () => draft.map(({ dragId: _dragId, ...stage }) => normalizeStage(stage)),
    [draft],
  )
  const dirty = useMemo(() => !stagesEqual(plainDraft, shown), [plainDraft, shown])
  const valid =
    draft.length > 0 && draft.every((s) => s.name.trim()) && draft.some((s) => s.kind === 'done')

  const update = (index: number, patch: Partial<TicketStage>) =>
    setDraft((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s
        const next = { ...s, ...patch }
        if (patch.kind != null && patch.kind !== 'done') {
          next.auto_close_conversation = false
        }
        return next
      }),
    )

  const remove = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index))
  }

  const add = () => {
    setDraft((prev) => [
      ...prev,
      {
        key: '',
        name: '',
        kind: 'open',
        auto_close_conversation: false,
        fields: [],
        owner: null,
        checkup_minutes: 0,
        dragId: newDragId(),
      },
    ])
    requestAnimationFrame(() => {
      const el = boardRef.current
      if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' })
    })
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setDraft((prev) => {
      const oldIndex = prev.findIndex((s) => s.dragId === active.id)
      const newIndex = prev.findIndex((s) => s.dragId === over.id)
      if (oldIndex < 0 || newIndex < 0) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  const payload = useMemo(
    () =>
      plainDraft.map((s) => ({
        ...s,
        name: s.name.trim(),
        fields: (s.fields ?? [])
          .filter((field) => field.name.trim())
          .map((field) => ({
            ...field,
            name: field.name.trim(),
            key: field.key || field.name.trim(),
            options:
              field.type === 'enum'
                ? (field.options ?? []).map((opt) => opt.trim()).filter(Boolean)
                : undefined,
          })),
      })),
    [plainDraft],
  )

  useEffect(() => {
    onDraftChange?.({ dirty, valid, stages: payload })
  }, [dirty, valid, payload, onDraftChange])

  const ids = draft.map((s) => s.dragId)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-heading">{t('workstreamsPage.stages.title')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t('workstreamsPage.stages.hint')}</p>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            {!draft.some((s) => s.kind === 'done') ? (
              <span className="text-xs text-status-error">{t('workstreamsPage.stages.needDone')}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        ref={boardRef}
        className="w-full overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]"
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            <div className="flex min-h-[220px] min-w-full w-max items-stretch gap-3">
              {draft.map((stage, index) => (
                <SortablePhaseCard
                  key={stage.dragId}
                  stage={stage}
                  index={index}
                  canEdit={canEdit}
                  canRemove={draft.length > 1}
                  owners={owners}
                  onUpdate={(patch) => update(index, patch)}
                  onRemove={() => remove(index)}
                />
              ))}

              {canEdit ? (
                <button
                  type="button"
                  onClick={add}
                  className="flex min-h-[220px] w-[140px] min-w-[120px] max-w-[160px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-bg-muted/15 px-4 text-sm text-text-muted transition-colors hover:border-accent/50 hover:bg-bg-muted/35 hover:text-text-primary"
                >
                  <Plus size={18} />
                  <span className="text-center text-xs font-medium leading-snug">
                    {t('workstreamsPage.stages.add')}
                  </span>
                </button>
              ) : null}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </section>
  )
}
