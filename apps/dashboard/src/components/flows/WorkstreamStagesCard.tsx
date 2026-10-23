import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable } from '../ui/pressable'
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
import { ChevronDown, GripVertical, Plus, Trash2, UserRound } from 'lucide-react'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import type { ChoiceItem } from '../ui/ChoiceOption'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  checkupLabel,
  stageLabel,
  type TicketStage,
  type TicketStageField,
  type TicketStageFieldType,
  type TicketChecklistEvidence,
  type TicketChecklistItemDef,
  type TicketStageKind,
  type TicketStageOwner,
  type TicketWaitingOn,
} from '../../lib/tickets-api'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import { listAgents } from '../../lib/agents-api'
import { EDITABLE_STAGE_KINDS, waitingStageFill } from '../../lib/stage-order'
import { StageProgressIcon } from './StageProgressIcon'
import { cn } from '../../lib/utils'
import { Input } from '../ui/input'

const KINDS: TicketStageKind[] = EDITABLE_STAGE_KINDS
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
    waiting_on: stage.kind === 'done' ? '' : (stage.waiting_on ?? ''),
    checklist: (stage.checklist ?? []).map((item) => ({
      key: item.key || '',
      label: item.label || '',
      required: Boolean(item.required),
      evidence: item.evidence ?? 'manual',
    })),
    exit_requires_checklist: Boolean(stage.exit_requires_checklist),
  }
}

const WAITING_ON: Array<TicketWaitingOn | ''> = ['', 'customer', 'us', 'third_party']
const EVIDENCE: TicketChecklistEvidence[] = ['manual', 'attachment', 'answer']
const MAX_CHECKLIST = 12

/** Who the stage waits on, its checklist, and whether the checklist gates the next stage. */
function StageWorkBlock({
  stage,
  canEdit,
  onUpdate,
}: {
  stage: TicketStage
  canEdit: boolean
  onUpdate: (patch: Partial<TicketStage>) => void
}) {
  const { t } = useTranslation('nav')
  const items = stage.checklist ?? []
  const setItem = (index: number, patch: Partial<TicketChecklistItemDef>) => {
    const next = [...items]
    next[index] = { ...next[index], ...patch }
    onUpdate({ checklist: next })
  }
  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-muted/20 p-2.5">
      {stage.kind !== 'done' ? (
        <div className="space-y-1">
          <Label className="text-xs text-text-muted">{t('workstreamsPage.stages.waitingOn')}</Label>
          <Select
            value={stage.waiting_on || 'turn'}
            disabled={!canEdit}
            onValueChange={(value) => onUpdate({ waiting_on: value === 'turn' ? '' : (value as TicketWaitingOn) })}
          >
            <SelectTrigger className="h-8 text-xs" aria-label={t('workstreamsPage.stages.waitingOn')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WAITING_ON.map((value) => (
                <SelectItem key={value || 'turn'} value={value || 'turn'}>
                  {value ? t(`tickets.waitingOn.${value}`) : t('workstreamsPage.stages.waitingOnTurn')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-2xs leading-snug text-text-muted">{t('workstreamsPage.stages.waitingOnHint')}</p>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label className="text-xs text-text-muted">{t('workstreamsPage.stages.checklist')}</Label>
        <p className="text-2xs leading-snug text-text-muted">{t('workstreamsPage.stages.checklistHint')}</p>
        {items.map((item, index) => (
          <div key={item.key || `new-${index}`} className="flex items-center gap-1.5">
            <Input
              value={item.label}
              disabled={!canEdit}
              placeholder={t('workstreamsPage.stages.checklistItem')}
              aria-label={t('workstreamsPage.stages.checklistItem')}
              onChange={(event) => setItem(index, { label: event.target.value })}
              className="h-7 min-w-0 flex-1 text-xs"
            />
            <Select
              value={item.evidence ?? 'manual'}
              disabled={!canEdit}
              onValueChange={(value) => setItem(index, { evidence: value as TicketChecklistEvidence })}
            >
              <SelectTrigger className="h-7 w-28 text-2xs" aria-label={t('workstreamsPage.stages.checklistEvidence')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVIDENCE.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`tickets.checklistEvidence.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={Boolean(item.required)}
              disabled={!canEdit}
              onCheckedChange={(checked) => setItem(index, { required: checked })}
              aria-label={t('workstreamsPage.stages.checklistRequired')}
              title={t('workstreamsPage.stages.checklistRequired')}
            />
            {canEdit ? (
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                onClick={() => onUpdate({ checklist: items.filter((_, i) => i !== index) })}
                className="text-text-muted hover:text-status-error"
                aria-label={t('workstreamsPage.stages.checklistRemove')}
              >
                <Trash2 size={14} aria-hidden />
              </Button>
            ) : null}
          </div>
        ))}
        {canEdit && items.length < MAX_CHECKLIST ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="px-2 text-xs"
            onClick={() => onUpdate({ checklist: [...items, { key: '', label: '', required: false, evidence: 'manual' }] })}
          >
            <Plus size={14} aria-hidden />
            {t('workstreamsPage.stages.checklistAdd')}
          </Button>
        ) : null}
      </div>

      {items.length > 0 && stage.kind !== 'done' ? (
        <label className="flex items-start gap-2.5">
          <Switch
            checked={Boolean(stage.exit_requires_checklist)}
            disabled={!canEdit}
            onCheckedChange={(checked) => onUpdate({ exit_requires_checklist: checked })}
            aria-label={t('workstreamsPage.stages.exitRequiresChecklist')}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-text-primary">
              {t('workstreamsPage.stages.exitRequiresChecklist')}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-text-muted">
              {t('workstreamsPage.stages.exitRequiresChecklistHint')}
            </span>
          </span>
        </label>
      ) : null}
    </div>
  )
}

export type StageOwnerOption = {
  value: string
  label: string
  group: 'user' | 'agent' | 'team'
} & Pick<ChoiceItem, 'agent' | 'person' | 'team'>

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
    <div className="space-y-2 rounded-lg border border-border bg-bg-muted/20 p-2.5">
      <div className="space-y-1">
        <Label className="text-xs text-text-muted">{t('workstreamsPage.stages.owner')}</Label>
        <ChoiceSelect
          aria-label={t('workstreamsPage.stages.owner')}
          triggerClassName="h-8 text-xs"
          value={ownerValue(stage.owner)}
          disabled={!canEdit}
          onValueChange={(value) => onUpdate({ owner: parseOwnerValue(value) })}
          groups={[
            {
              items: [
                {
                  value: 'keep',
                  label: t('workstreamsPage.stages.ownerKeep'),
                  kind: 'icon',
                  icon: UserRound,
                },
              ],
            },
            ...groups.map((group) => ({
              label: t(`workstreamsPage.stages.ownerGroups.${group}`),
              items: owners
                .filter((row) => row.group === group)
                .map(
                  (row): ChoiceItem => ({
                    value: row.value,
                    label: row.label,
                    kind: group === 'user' ? 'person' : group === 'agent' ? 'agent' : 'team',
                    agent: row.agent,
                    person: row.person,
                    team: row.team,
                  }),
                ),
            })),
            ...(stage.owner?.id && !owners.some((row) => row.value === ownerValue(stage.owner))
              ? [
                  {
                    items: [
                      {
                        value: ownerValue(stage.owner),
                        label: t('workstreamsPage.stages.ownerUnknown'),
                        kind: 'icon' as const,
                      },
                    ],
                  },
                ]
              : []),
          ]}
        />
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
  fill,
  canEdit,
  canRemove,
  owners,
  onUpdate,
  onRemove,
}: {
  stage: DraftStage
  index: number
  fill?: number
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
        'flex shrink-0 flex-col rounded-xl border border-border bg-bg-elevated/90 shadow-sm',
        isDragging && 'z-20 border-accent/50 opacity-95 shadow-md',
      )}
    >
      <header className="flex items-center gap-1.5 border-b border-border px-2 py-2.5 sm:px-3">
        {canEdit ? (
          <Button variant="ghost" size="iconSm"
            type="button"
            {...attributes}
            {...listeners}
            className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
            aria-label={t('workstreamsPage.stages.dragAria', {
              defaultValue: 'Drag to reorder',
              name: stage.name || String(index + 1),
            })}
          >
            <GripVertical size={16} />
          </Button>
        ) : null}
        <StageProgressIcon kind={stage.kind} fill={fill} size={18} />
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
              className="min-w-0 flex-1 cursor-text rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-semibold uppercase tracking-caps text-text-heading outline-none transition-colors placeholder:normal-case placeholder:tracking-normal placeholder:text-text-muted hover:border-border hover:bg-bg-input/90 focus:border-border focus:bg-bg-input focus:ring-1 focus:ring-border/60"
            />
          ) : (
            <p className="truncate text-xs font-semibold uppercase tracking-caps text-text-heading">
              {stage.name.trim() || t('workstreamsPage.stages.namePlaceholder')}
            </p>
          )}
        </div>
        {canEdit ? (
          <Button
            type="button"
            size="iconSm"
            variant="ghost"
            className="shrink-0 p-0 text-text-muted hover:text-status-error"
            disabled={!canRemove}
            aria-label={t('workstreamsPage.stages.remove')}
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </Button>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="space-y-1.5 rounded-lg border border-border bg-bg-muted/20 p-2.5">
          <Label className="text-xs text-text-muted">{t('workstreamsPage.stages.kind')}</Label>
          {stage.kind === 'open' ? (
            <p className="flex h-8 items-center rounded-md border border-border bg-bg-input/40 px-2.5 text-xs text-text-secondary">
              {t('workstreamsPage.stages.kinds.open')}
            </p>
          ) : (
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
          )}
        </div>

        <StageOwnerFields stage={stage} owners={owners} canEdit={canEdit} onUpdate={onUpdate} />

        {stage.kind === 'done' ? (
          <label className="flex items-start gap-2.5 rounded-lg border border-border bg-bg-muted/20 px-2.5 py-2">
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

        <StageWorkBlock stage={stage} canEdit={canEdit} onUpdate={onUpdate} />

        <StageFieldsBlock stage={stage} canEdit={canEdit} onUpdate={onUpdate} />
      </div>
    </article>
  )
}

function StageFieldsBlock({
  stage,
  canEdit,
  onUpdate,
}: {
  stage: TicketStage & { dragId?: string }
  canEdit: boolean
  onUpdate: (patch: Partial<TicketStage>) => void
}) {
  const { t } = useTranslation('nav')
  const fieldCount = stage.fields?.length ?? 0
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const rowId = stage.dragId || stage.key || 'stage'
  return (
        <div className="space-y-2 rounded-lg border border-border bg-bg-muted/20 p-2.5">
          <Pressable
            type="button"
            onClick={() => setFieldsOpen((open) => !open)}
            aria-expanded={fieldsOpen}
            className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-text-muted hover:text-text-primary"
          >
            <ChevronDown
              size={14}
              className={cn('shrink-0 transition-transform', !fieldsOpen && '-rotate-90')}
              aria-hidden
            />
            <span>{t('workstreamsPage.stages.fields')}</span>
            {fieldCount > 0 ? (
              <span className="ml-auto rounded bg-bg-muted px-1.5 text-2xs tabular-nums text-text-secondary">
                {fieldCount}
              </span>
            ) : null}
          </Pressable>
          {fieldsOpen ? (
            <p className="text-2xs leading-snug text-text-muted">{t('workstreamsPage.stages.fieldsHint')}</p>
          ) : null}
          {fieldsOpen ? (stage.fields ?? []).map((field, fieldIndex) => (
            <div
              key={`${rowId}-field-${fieldIndex}`}
              className="space-y-1.5 rounded-md border border-border bg-bg-surface/80 p-2"
            >
              <div className="flex items-center gap-1">
                <Input
                  value={field.name}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const fields = [...(stage.fields ?? [])]
                    fields[fieldIndex] = { ...field, name: e.target.value }
                    onUpdate({ fields })
                  }}
                  placeholder={t('workstreamsPage.stages.fieldName')}
                  aria-label={t('workstreamsPage.stages.fieldName')}
                  className="h-7 min-w-0 flex-1 text-xs"
                />
                {canEdit ? (
                  <Button
                    type="button"
                    size="iconSm"
                    variant="ghost"
                    className="shrink-0 p-0 text-text-muted hover:text-status-error"
                    aria-label={t('workstreamsPage.stages.fieldRemove')}
                    onClick={() => {
                      const fields = (stage.fields ?? []).filter((_, i) => i !== fieldIndex)
                      onUpdate({ fields })
                    }}
                  >
                    <Trash2 size={14} />
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
                <div className="space-y-1.5 rounded-md border border-dashed border-border p-1.5">
                  <p className="text-2xs font-medium text-text-muted">
                    {t('workstreamsPage.stages.fieldOptions')}
                  </p>
                  {(field.options ?? ['', '']).map((option, optionIndex) => (
                    <div key={`${rowId}-opt-${fieldIndex}-${optionIndex}`} className="flex items-center gap-1">
                      <Input
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
                        className="h-7 min-w-0 flex-1 text-2xs"
                      />
                      {canEdit && (field.options?.length ?? 0) > 2 ? (
                        <Button
                          type="button"
                          size="iconSm"
                          variant="ghost"
                          className="shrink-0 p-0 text-text-muted hover:text-status-error"
                          aria-label={t('workstreamsPage.stages.fieldOptionRemove')}
                          onClick={() => {
                            const options = (field.options ?? []).filter((_, i) => i !== optionIndex)
                            const fields = [...(stage.fields ?? [])]
                            fields[fieldIndex] = { ...field, options }
                            onUpdate({ fields })
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {canEdit && (field.options?.length ?? 0) < MAX_ENUM_OPTIONS ? (
                    <Pressable
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
                      <Plus size={14} />
                      {t('workstreamsPage.stages.fieldOptionAdd')}
                    </Pressable>
                  ) : null}
                </div>
              ) : null}
            </div>
          )) : null}
          {fieldsOpen && canEdit && fieldCount < MAX_FIELDS ? (
            <Pressable
              type="button"
              onClick={() =>
                onUpdate({
                  fields: [
                    ...(stage.fields ?? []),
                    { key: '', name: '', type: 'text', required: false },
                  ],
                })
              }
              className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-2xs text-text-muted hover:border-accent/40 hover:text-text-primary"
            >
              <Plus size={14} />
              {t('workstreamsPage.stages.fieldAdd')}
            </Pressable>
          ) : null}
        </div>
  )
}

function useStageOwners(): StageOwnerOption[] {
  const { members } = useMembers()
  const { teams } = useTeams()
  const [agents, setAgents] = useState<
    {
      id: string
      name: string
      avatar_kind?: string | null
      avatar_icon?: string | null
      avatar_color?: string | null
      avatar_shape?: string | null
      avatar_image_url?: string | null
    }[]
  >([])

  useEffect(() => {
    let cancelled = false
    listAgents()
      .then((rows) => {
        if (!cancelled) {
          setAgents(
            rows.map((row) => ({
              id: row.id,
              name: row.name,
              avatar_kind: row.avatar_kind,
              avatar_icon: row.avatar_icon,
              avatar_color: row.avatar_color,
              avatar_shape: row.avatar_shape,
              avatar_image_url: row.avatar_image_url,
            })),
          )
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return useMemo<StageOwnerOption[]>(
    () => [
      ...members
        .filter((m) => m.uuid)
        .map((m) => ({
          value: `user:${m.uuid}`,
          label: m.name || m.email,
          group: 'user' as const,
          person: { name: m.name || m.email, email: m.email, avatarUrl: m.avatarUrl },
        })),
      ...agents.map((agent) => ({
        value: `agent:${agent.id}`,
        label: agent.name,
        group: 'agent' as const,
        agent,
      })),
      ...teams.map((team) => ({
        value: `team:${team.id}`,
        label: team.name,
        group: 'team' as const,
        team,
      })),
    ],
    [members, agents, teams],
  )
}

/** One stage: name, kind, owner, check-up and intake fields. Saves from the board. */
export function StageEditorDialog({
  stage,
  open,
  onOpenChange,
  canRemove,
  canMoveLeft = false,
  canMoveRight = false,
  kinds,
  saving,
  onSave,
  onRemove,
  onMove,
}: {
  stage: TicketStage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  canRemove: boolean
  canMoveLeft?: boolean
  canMoveRight?: boolean
  /** Editable kinds this stage may take (never not-started). */
  kinds?: TicketStageKind[]
  saving?: boolean
  onSave: (stage: TicketStage) => void
  onRemove: () => void
  onMove?: (direction: -1 | 1) => void
}) {
  const { t } = useTranslation('nav')
  const owners = useStageOwners()
  const [draft, setDraft] = useState<TicketStage | null>(null)
  const lockedNotStarted = draft?.kind === 'open'

  const stageKey = stage?.key ?? ''
  useEffect(() => {
    if (open && stage) setDraft(normalizeStage(stage))
    // Reload the form when a different stage opens, not when the list reorders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stageKey])

  const update = (patch: Partial<TicketStage>) =>
    setDraft((prev) => {
      if (!prev) return prev
      // Not-started is fixed on the first column — never reassign it here.
      if (prev.kind === 'open' && patch.kind != null && patch.kind !== 'open') return prev
      const next = { ...prev, ...patch }
      if (patch.kind != null && patch.kind !== 'done') next.auto_close_conversation = false
      if (patch.kind === 'done') next.checkup_minutes = 0
      return next
    })

  const kindChoices = (kinds?.length ? kinds : KINDS).filter((kind) => kind !== 'open')

  const save = () => {
    if (!draft || !draft.name.trim()) return
    onSave({
      ...normalizeStage(draft),
      name: draft.name.trim().slice(0, 60),
      fields: (draft.fields ?? [])
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
      checklist: (draft.checklist ?? [])
        .filter((item) => item.label.trim())
        .map((item) => ({ ...item, label: item.label.trim(), key: item.key || item.label.trim() })),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workstreamsPage.stages.editTitle')}</DialogTitle>
        </DialogHeader>
        {draft ? (
          <div className="space-y-3">
            <input
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder={t('workstreamsPage.stages.namePlaceholder')}
              aria-label={t('workstreamsPage.stages.namePlaceholder')}
              className="h-9 w-full rounded-md border border-border bg-bg-input/80 px-2.5 text-sm font-medium text-text-heading outline-none focus:border-border focus:ring-1 focus:ring-border/60"
            />
            {onMove ? (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={saving || !canMoveLeft} onClick={() => onMove(-1)}>
                  {t('workstreamsPage.stages.moveLeft')}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={saving || !canMoveRight} onClick={() => onMove(1)}>
                  {t('workstreamsPage.stages.moveRight')}
                </Button>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label className="text-xs text-text-muted">{t('workstreamsPage.stages.kind')}</Label>
              {lockedNotStarted ? (
                <p className="flex h-8 items-center rounded-md border border-border bg-bg-input/40 px-2.5 text-xs text-text-secondary">
                  {t('workstreamsPage.stages.kinds.open')}
                </p>
              ) : (
                <Select value={draft.kind} onValueChange={(value) => update({ kind: value as TicketStageKind })}>
                  <SelectTrigger className="h-8 text-xs" aria-label={t('workstreamsPage.stages.kind')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kindChoices.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`workstreamsPage.stages.kinds.${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <StageOwnerFields stage={draft} owners={owners} canEdit onUpdate={update} />
            {draft.kind === 'done' ? (
              <label className="flex items-start gap-2.5 rounded-lg border border-border bg-bg-muted/20 px-2.5 py-2">
                <Switch
                  checked={Boolean(draft.auto_close_conversation)}
                  onCheckedChange={(checked) => update({ auto_close_conversation: checked })}
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
            <StageWorkBlock stage={draft} canEdit onUpdate={update} />
            <StageFieldsBlock stage={draft} canEdit onUpdate={update} />
          </div>
        ) : null}
        <DialogFooter className="gap-2 sm:justify-between">
          {canRemove && !lockedNotStarted ? (
            <Button type="button" variant="ghost" className="text-status-error" disabled={saving} onClick={onRemove}>
              {t('workstreamsPage.stages.remove')}
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" disabled={saving || !draft?.name.trim()} onClick={save}>
            {t('workstreamsPage.editBar.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const owners = useStageOwners()

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
        // Not-started stays on the first column only.
        if (s.kind === 'open' && patch.kind != null && patch.kind !== 'open') return s
        if (patch.kind === 'open') return s
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
        kind: 'waiting',
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
                  fill={waitingStageFill(draft, index)}
                  canEdit={canEdit}
                  canRemove={draft.length > 1 && stage.kind !== 'open'}
                  owners={owners}
                  onUpdate={(patch) => update(index, patch)}
                  onRemove={() => remove(index)}
                />
              ))}

              {canEdit ? (
                <Pressable
                  onClick={add}
                  className="flex min-h-[220px] w-[140px] min-w-[120px] max-w-[160px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-bg-muted/15 px-4 text-sm text-text-muted transition-colors hover:border-accent/50 hover:bg-bg-muted/35 hover:text-text-primary"
                >
                  <Plus size={20} />
                  <span className="text-center text-xs font-medium leading-snug">
                    {t('workstreamsPage.stages.add')}
                  </span>
                </Pressable>
              ) : null}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </section>
  )
}
