/**
 * Canonical intake-type catalog for the Cases hub (`/cases?tab=types`).
 *
 * Types are the only intent catalog: AI triage and operators classify
 * conversations with these, and optional bindings route them to a
 * workstream or project. Bindings themselves are configured on the
 * workstream / project detail pages (the sinks).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Plus, Radar, ShieldCheck, Trash2 } from 'lucide-react'
import {
  createCaseType,
  deleteCaseType,
  listCaseBindings,
  listCaseTypes,
  patchCaseType,
  type CaseBindingRow,
  type CaseCreateMode,
  type CaseTypeRow,
} from '../../lib/cases-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import ConfirmDeleteDialog from '../ui/ConfirmDeleteDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { EmptyState } from '../ui/empty-state'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'

const CREATE_MODES: CaseCreateMode[] = ['ask_customer', 'ask_operator', 'auto', 'manual_only']
const AUDIENCES: CaseTypeRow['audience'][] = ['customer', 'internal', 'both']

type CaseTypesCardProps = {
  /** Notify the hub so the queue's type chips stay in sync. */
  onTypesChanged?: (rows: CaseTypeRow[]) => void
}

export function CaseTypesCard({ onTypesChanged }: CaseTypesCardProps) {
  const { t } = useTranslation('nav')
  const [rows, setRows] = useState<CaseTypeRow[]>([])
  const [bindings, setBindings] = useState<CaseBindingRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CaseTypeRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    const [types, binds] = await Promise.all([
      listCaseTypes(),
      listCaseBindings().catch(() => [] as CaseBindingRow[]),
    ])
    setRows(types)
    setBindings(binds)
    setLoaded(true)
    onTypesChanged?.(types)
  }, [onTypesChanged])

  useEffect(() => {
    void load().catch(() => setLoaded(true))
  }, [load])

  const bindingsByType = useMemo(() => {
    const map = new Map<string, CaseBindingRow[]>()
    for (const binding of bindings) {
      const list = map.get(binding.case_type_id) ?? []
      list.push(binding)
      map.set(binding.case_type_id, list)
    }
    return map
  }, [bindings])

  const toggle = async (row: CaseTypeRow, enabled: boolean) => {
    try {
      await patchCaseType(row.id, { enabled })
      await load()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('cases.updateTypeError', { defaultValue: 'Could not update the type.' })),
      )
    }
  }

  const removeType = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteCaseType(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('cases.updateTypeError', { defaultValue: 'Could not update the type.' })),
      )
    } finally {
      setDeleting(false)
    }
  }

  const modeLabel = (mode: CaseCreateMode) =>
    t(`casesPage.modes.${mode}`, {
      defaultValue: { ask_customer: 'Ask customer', ask_operator: 'Ask operator', auto: 'Auto', manual_only: 'Manual only' }[mode],
    })

  const audienceLabel = (audience: CaseTypeRow['audience']) =>
    t(`casesPage.audiences.${audience}`, {
      defaultValue: { customer: 'Customer', internal: 'Internal', both: 'Both' }[audience],
    })

  const bindingSummary = (row: CaseTypeRow): string => {
    const list = bindingsByType.get(row.id) ?? []
    if (list.length === 0) return t('casesPage.noBinding', { defaultValue: 'Label only — no follow-up' })
    const workstreams = list.filter((b) => b.target_kind === 'workstream').length
    const projects = list.filter((b) => b.target_kind === 'project').length
    const parts: string[] = []
    if (workstreams > 0)
      parts.push(t('casesPage.boundWorkstreams', { defaultValue: '{{count}} workstream(s)', count: workstreams }))
    if (projects > 0)
      parts.push(t('casesPage.boundProjects', { defaultValue: '{{count}} project(s)', count: projects }))
    return parts.join(' · ')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-xl text-xs text-text-muted">
          {t('casesPage.typesIntro', {
            defaultValue:
              'Types are the intent catalog. Write a sharp description of when a type applies (and when not) so agents classify well. Bind a type on a workstream or project when it needs follow-up; leave it unbound to use it as a label only.',
          })}
        </p>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} className="mr-1" />
          {t('casesPage.newType', { defaultValue: 'New type' })}
        </Button>
      </div>

      {loaded && rows.length === 0 ? (
        <EmptyState
          icon={Radar}
          title={t('casesPage.typesEmptyTitle', { defaultValue: 'No intake types yet' })}
          description={t('casesPage.typesEmptyBody', {
            defaultValue: 'Create a type for each kind of work that lands in conversations, like complaints or refund requests.',
          })}
          action={
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              {t('casesPage.newType', { defaultValue: 'New type' })}
            </Button>
          }
        />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const expanded = expandedId === row.id
            return (
              <li key={row.id} className="rounded-lg border border-border/50 bg-bg-elevated/40">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setExpandedId(expanded ? null : row.id)
                    }
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-heading">{row.name}</span>
                      {row.module_slug ? (
                        <Badge variant="outline" className="text-[10px]">
                          {row.module_slug}
                        </Badge>
                      ) : null}
                      {row.requires_verification ? (
                        <span title={t('cases.needsVerify', { defaultValue: 'needs confirmation' })}>
                          <ShieldCheck size={13} className="text-status-success" aria-hidden />
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                      {modeLabel(row.create_mode)} · {audienceLabel(row.audience)} · {bindingSummary(row)}
                    </span>
                  </span>
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(v) => void toggle(row, v)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t('casesPage.enabledToggle', { defaultValue: 'Enabled' })}
                  />
                  {expanded ? (
                    <ChevronUp size={14} className="shrink-0 text-text-muted" />
                  ) : (
                    <ChevronDown size={14} className="shrink-0 text-text-muted" />
                  )}
                </div>
                {expanded ? (
                  <CaseTypeEditor
                    row={row}
                    onSaved={() => void load()}
                    onDelete={() => setDeleteTarget(row)}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-[11px] text-text-muted">
        {t('casesPage.bindHint', {
          defaultValue: 'Routing is configured where work is done: open a workstream or project to accept types there.',
        })}{' '}
        <Link to="/workstreams" className="font-medium text-accent hover:underline">
          {t('casesPage.openWorkstreams', { defaultValue: 'Open Workstreams' })}
        </Link>
      </p>

      <CreateCaseTypeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          void load()
        }}
      />

      {deleteTarget ? (
        <ConfirmDeleteDialog
          title={t('casesPage.deleteTypeTitle', { defaultValue: 'Delete intake type' })}
          itemLabel={t('casesPage.deleteTypeLabel', { defaultValue: 'this type' })}
          itemName={deleteTarget.name}
          impactText={t('casesPage.deleteTypeImpact', {
            defaultValue: 'Existing cases keep their history; bindings on workstreams and projects are removed.',
          })}
          isDeleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={removeType}
        />
      ) : null}
    </div>
  )
}

function CaseTypeEditor({
  row,
  onSaved,
  onDelete,
}: {
  row: CaseTypeRow
  onSaved: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('nav')
  const [description, setDescription] = useState(row.description)
  const [createMode, setCreateMode] = useState<CaseCreateMode>(row.create_mode)
  const [audience, setAudience] = useState<CaseTypeRow['audience']>(row.audience)
  const [requiresVerification, setRequiresVerification] = useState(row.requires_verification)
  const [saving, setSaving] = useState(false)

  const dirty =
    description !== row.description ||
    createMode !== row.create_mode ||
    audience !== row.audience ||
    requiresVerification !== row.requires_verification

  const save = async () => {
    setSaving(true)
    try {
      await patchCaseType(row.id, {
        description,
        create_mode: createMode,
        audience,
        requires_verification: requiresVerification,
      })
      onSaved()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('cases.updateTypeError', { defaultValue: 'Could not update the type.' })),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border/50 px-3 py-3">
      <div>
        <label className="mb-1 block text-[11px] font-medium text-text-secondary">
          {t('casesPage.descriptionLabel', { defaultValue: 'Description (when to use, when not)' })}
        </label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t('casesPage.descriptionPlaceholder', {
            defaultValue: 'e.g. Customer explicitly asks for a refund. Not for general billing questions.',
          })}
          className="text-sm"
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-text-secondary">
            {t('casesPage.modeLabel', { defaultValue: 'Create mode' })}
          </label>
          <Select value={createMode} onValueChange={(v) => setCreateMode(v as CaseCreateMode)}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CREATE_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`casesPage.modes.${mode}`, {
                    defaultValue: { ask_customer: 'Ask customer', ask_operator: 'Ask operator', auto: 'Auto', manual_only: 'Manual only' }[mode],
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-text-secondary">
            {t('casesPage.audienceLabel', { defaultValue: 'Audience' })}
          </label>
          <Select value={audience} onValueChange={(v) => setAudience(v as CaseTypeRow['audience'])}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIENCES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`casesPage.audiences.${value}`, {
                    defaultValue: { customer: 'Customer', internal: 'Internal', both: 'Both' }[value],
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex h-8 items-center gap-2 text-xs text-text-secondary">
          <Switch checked={requiresVerification} onCheckedChange={setRequiresVerification} />
          {t('cases.needsVerify', { defaultValue: 'needs confirmation' })}
        </label>
      </div>
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-status-error hover:text-status-error"
          onClick={onDelete}
          disabled={Boolean(row.module_slug)}
          title={
            row.module_slug
              ? t('casesPage.moduleTypeNoDelete', { defaultValue: 'Module types cannot be deleted here.' })
              : undefined
          }
        >
          <Trash2 size={13} className="mr-1" />
          {t('casesPage.deleteType', { defaultValue: 'Delete' })}
        </Button>
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving
            ? t('casesPage.saving', { defaultValue: 'Saving...' })
            : t('casesPage.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  )
}

function CreateCaseTypeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation('nav')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [createMode, setCreateMode] = useState<CaseCreateMode>('ask_customer')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await createCaseType({ name: trimmed, description, create_mode: createMode })
      setName('')
      setDescription('')
      setCreateMode('ask_customer')
      onCreated()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('cases.createTypeError', { defaultValue: 'Could not create the type.' })),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('casesPage.newType', { defaultValue: 'New type' })}</DialogTitle>
          <DialogDescription>
            {t('casesPage.newTypeHint', {
              defaultValue: 'Describe precisely when this type applies so agents classify incoming messages well.',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('cases.newTypePlaceholder', { defaultValue: 'New type name' })}
            autoFocus
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={t('casesPage.descriptionPlaceholder', {
              defaultValue: 'e.g. Customer explicitly asks for a refund. Not for general billing questions.',
            })}
            className="text-sm"
          />
          <Select value={createMode} onValueChange={(v) => setCreateMode(v as CaseCreateMode)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CREATE_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`casesPage.modes.${mode}`, {
                    defaultValue: { ask_customer: 'Ask customer', ask_operator: 'Ask operator', auto: 'Auto', manual_only: 'Manual only' }[mode],
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('casesPage.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="button" disabled={busy || !name.trim()} onClick={() => void create()}>
            {t('cases.createType', { defaultValue: 'Add type' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CaseTypesCard
