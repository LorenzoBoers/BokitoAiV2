/**
 * Signal types catalog (`/settings/signals`).
 *
 * One screen answers three questions per type: what it is, what we do with it,
 * and where the work lands. Interpretation classifies every inbound message
 * against this catalog and never invents a type — patterns it keeps seeing land
 * in the backlog at the bottom, where an owner turns them into a type.
 *
 * Internal names stay Case / CaseType; operators read Signal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, Inbox, Plus, Radar, ShieldCheck, Trash2, Users } from 'lucide-react'
import PageContent from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import ConfirmDeleteDialog from '../components/ui/ConfirmDeleteDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { EmptyState } from '../components/ui/empty-state'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { LoadingBlock } from '../components/ui/loading-block'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Textarea } from '../components/ui/textarea'
import {
  createCaseBinding,
  createCaseType,
  deleteCaseBinding,
  deleteCaseType,
  dismissSignalBacklog,
  getSignalPolicy,
  listCaseBindings,
  listCaseTypes,
  listSignalBacklog,
  patchCaseType,
  promoteSignalBacklog,
  saveSignalPolicy,
  type CaseBindingRow,
  type CaseCreateMode,
  type CaseTypeRow,
  type SignalAcceptRoles,
  type SignalBacklogEntry,
  type SignalPolicy,
} from '../lib/cases-api'
import { inboxPath } from '../lib/messages-paths'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkstreams, type WorkstreamRow } from '../lib/workstreams-api'
import { cn } from '../lib/utils'

const NONE = '__none__'

const CREATE_MODES: CaseCreateMode[] = ['ask_customer', 'ask_operator', 'auto', 'manual_only']
const AUDIENCES: CaseTypeRow['audience'][] = ['customer', 'internal', 'both']

const CREATE_MODE_FALLBACK: Record<CaseCreateMode, string> = {
  ask_customer: 'Ask customer',
  ask_operator: 'Ask operator',
  auto: 'Auto',
  manual_only: 'Manual only',
}

const AUDIENCE_FALLBACK: Record<CaseTypeRow['audience'], string> = {
  customer: 'Customer',
  internal: 'Internal',
  both: 'Both',
}

type CatalogData = {
  types: CaseTypeRow[]
  bindings: CaseBindingRow[]
  projects: ProjectRow[]
  workstreams: WorkstreamRow[]
}

export default function SignalTypesSettings() {
  const { t } = useTranslation('nav')
  const [data, setData] = useState<CatalogData | null>(null)
  const [policy, setPolicy] = useState<SignalPolicy | null>(null)
  const [backlog, setBacklog] = useState<SignalBacklogEntry[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CaseTypeRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [savingPolicy, setSavingPolicy] = useState(false)

  const load = useCallback(async () => {
    const [types, bindings, projects, workstreams] = await Promise.all([
      listCaseTypes(),
      listCaseBindings().catch(() => [] as CaseBindingRow[]),
      listProjects().catch(() => [] as ProjectRow[]),
      listWorkstreams().catch(() => [] as WorkstreamRow[]),
    ])
    setData({ types, bindings, projects, workstreams })
  }, [])

  const loadBacklog = useCallback(async () => {
    const res = await listSignalBacklog().catch(() => ({ items: [], threshold: 3 }))
    setBacklog(res.items)
  }, [])

  useEffect(() => {
    void load().catch((err) =>
      toast.error(
        formatApiErrorMessage(err, t('signalTypes.loadError', { defaultValue: 'Could not load signal types.' })),
      ),
    )
    void getSignalPolicy().then(setPolicy).catch(() => setPolicy(null))
    void loadBacklog()
  }, [load, loadBacklog, t])

  const bindingsByType = useMemo(() => {
    const map = new Map<string, CaseBindingRow[]>()
    for (const binding of data?.bindings ?? []) {
      const list = map.get(binding.case_type_id) ?? []
      list.push(binding)
      map.set(binding.case_type_id, list)
    }
    return map
  }, [data])

  const savePolicy = async (patch: { accept_roles?: SignalAcceptRoles; backlog_threshold?: number }) => {
    setSavingPolicy(true)
    try {
      setPolicy(await saveSignalPolicy(patch))
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('signalTypes.policyError', { defaultValue: 'Could not save the policy.' })),
      )
    } finally {
      setSavingPolicy(false)
    }
  }

  const toggleType = async (row: CaseTypeRow, enabled: boolean) => {
    try {
      await patchCaseType(row.id, { enabled })
      await load()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('signalTypes.saveError', { defaultValue: 'Could not update the type.' })),
      )
    }
  }

  const removeType = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const result = await deleteCaseType(deleteTarget.id)
      setDeleteTarget(null)
      toast.success(
        result?.archived
          ? t('signalTypes.archived', {
              defaultValue: 'Type archived. Existing signals stay on their conversations.',
            })
          : t('signalTypes.deleted', { defaultValue: 'Type deleted.' }),
      )
      await load()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('signalTypes.saveError', { defaultValue: 'Could not update the type.' })),
      )
    } finally {
      setDeleting(false)
    }
  }

  const summaryLine = (row: CaseTypeRow): string => {
    // A playbook binding makes the category a ticket; without one it only labels.
    const playbook = (bindingsByType.get(row.id) ?? []).find(
      (b) => b.target_kind === 'workstream' && b.enabled,
    )
    const parts: string[] = [
      playbook
        ? t('signalTypes.outcomes.ticket', { defaultValue: 'Ticket' })
        : t('signalTypes.outcomes.label', { defaultValue: 'Label only' }),
    ]
    if (playbook) {
      const ws = data?.workstreams.find((w) => w.id === playbook.target_id)
      if (ws) parts.push(ws.name)
    }
    if (row.default_project_id) {
      const project = data?.projects.find((p) => p.id === row.default_project_id)
      if (project) parts.push(project.name)
    }
    return parts.join(' · ')
  }

  return (
    <PageContent width="md" className="space-y-6">
      <PageIntro
        description={t('signalTypes.intro', {
          defaultValue:
            'Signals are the kinds of work that arrive in conversations. Every inbound message is read against this catalog: a certain match files a signal, an unsure match asks for a confirm on the thread, and anything new lands in the backlog below.',
        })}
      />

      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-sm font-medium text-text-heading">
            {t('signalTypes.policyTitle', { defaultValue: 'Who may accept signals' })}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {t('signalTypes.policyDescription', {
              defaultValue:
                'Accepting turns a proposed signal on a conversation into real work. Owners and admins may always accept.',
            })}
          </p>
        </div>
        {!policy ? (
          <LoadingBlock variant="inline" label={t('signalTypes.loading', { defaultValue: 'Loading...' })} />
        ) : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Users size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="signal-accept-roles" className="text-sm font-medium">
                    {t('signalTypes.acceptRolesLabel', { defaultValue: 'Accepting a signal' })}
                  </Label>
                  <p className="mt-0.5 max-w-sm text-xs text-text-muted">
                    {t('signalTypes.acceptRolesHint', {
                      defaultValue:
                        'Members can always add a signal they spot themselves; this decides who may confirm one the AI proposed.',
                    })}
                  </p>
                </div>
              </div>
              <Select
                value={policy.accept_roles}
                onValueChange={(v) => void savePolicy({ accept_roles: v as SignalAcceptRoles })}
                disabled={savingPolicy}
              >
                <SelectTrigger id="signal-accept-roles" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admins">
                    {t('signalTypes.acceptAdmins', { defaultValue: 'Owners and admins only' })}
                  </SelectItem>
                  <SelectItem value="members">
                    {t('signalTypes.acceptMembers', { defaultValue: 'Anyone in the workspace' })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-5">
              <div className="flex items-start gap-3">
                <Radar size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="signal-backlog-threshold" className="text-sm font-medium">
                    {t('signalTypes.thresholdLabel', { defaultValue: 'Offer a new type after' })}
                  </Label>
                  <p className="mt-0.5 max-w-sm text-xs text-text-muted">
                    {t('signalTypes.thresholdHint', {
                      defaultValue:
                        'How often the same unknown pattern must arrive before Bokito offers it as a new type.',
                    })}
                  </p>
                </div>
              </div>
              <Select
                value={String(policy.backlog_threshold)}
                onValueChange={(v) => void savePolicy({ backlog_threshold: Number(v) })}
                disabled={savingPolicy}
              >
                <SelectTrigger id="signal-backlog-threshold" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2, 3, 5, 8].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {t('signalTypes.thresholdOption', { defaultValue: '{{count}} sightings', count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </Card>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-text-heading">
              {t('signalTypes.catalogTitle', { defaultValue: 'Signal types' })}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {t('signalTypes.catalogDescription', {
                defaultValue: 'What it is, and what we do when it arrives.',
              })}
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} className="mr-1" />
            {t('signalTypes.newType', { defaultValue: 'New type' })}
          </Button>
        </div>

        {!data ? (
          <LoadingBlock variant="inline" label={t('signalTypes.loading', { defaultValue: 'Loading...' })} />
        ) : data.types.length === 0 ? (
          <EmptyState
            icon={Radar}
            title={t('signalTypes.emptyTitle', { defaultValue: 'No signal types yet' })}
            description={t('signalTypes.emptyBody', {
              defaultValue:
                'Add a type for each kind of work that arrives in conversations, like a complaint or a refund request.',
            })}
            action={
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                {t('signalTypes.newType', { defaultValue: 'New type' })}
              </Button>
            }
          />
        ) : (
          <ul className="space-y-1.5">
            {data.types.map((row) => {
              const expanded = expandedId === row.id
              return (
                <li key={row.id} className="overflow-hidden rounded-lg border border-border/60">
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
                    aria-expanded={expanded}
                    className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-hover/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate-fade text-sm font-medium text-text-heading">{row.name}</span>
                        {row.module_slug ? (
                          <Badge variant="outline" className="text-2xs">
                            {row.module_slug}
                          </Badge>
                        ) : null}
                        {row.requires_verification ? (
                          <span
                            title={t('signalTypes.needsVerify', { defaultValue: 'needs confirmation' })}
                          >
                            <ShieldCheck size={13} className="text-status-success" aria-hidden />
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate-fade text-xs text-text-muted">
                        {row.description?.trim()
                          ? row.description
                          : t('signalTypes.noDescription', { defaultValue: 'No description yet' })}
                      </span>
                      <span className="mt-0.5 block truncate-fade text-xs text-text-secondary">
                        {summaryLine(row)}
                      </span>
                    </span>
                    <Switch
                      checked={row.enabled}
                      onCheckedChange={(v) => void toggleType(row, v)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t('signalTypes.enabledToggle', { defaultValue: 'Enabled' })}
                    />
                    <ChevronDown
                      size={16}
                      className={cn('shrink-0 text-text-muted transition-transform', expanded && 'rotate-180')}
                    />
                  </div>
                  {expanded ? (
                    <SignalTypeEditor
                      key={row.id}
                      row={row}
                      bindings={bindingsByType.get(row.id) ?? []}
                      projects={data.projects}
                      workstreams={data.workstreams}
                      onSaved={() => void load()}
                      onDelete={() => setDeleteTarget(row)}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-text-heading">
            {t('signalTypes.backlogTitle', { defaultValue: 'What we missed' })}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {t('signalTypes.backlogDescription', {
              defaultValue:
                'Requests that kept arriving without a matching type. Nothing is created automatically — turn one into a type when it is worth tracking.',
            })}
          </p>
        </div>
        {backlog.length === 0 ? (
          <p className="text-xs text-text-muted">
            {t('signalTypes.backlogEmpty', {
              defaultValue: 'Nothing unmatched yet. Your catalog covers what has been arriving.',
            })}
          </p>
        ) : (
          <ul className="space-y-2">
            {backlog.map((entry) => (
              <BacklogRow
                key={entry.key}
                entry={entry}
                onChanged={() => {
                  void loadBacklog()
                  void load()
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      <CreateSignalTypeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          void load()
        }}
      />

      {deleteTarget ? (
        <ConfirmDeleteDialog
          title={t('signalTypes.deleteTitle', { defaultValue: 'Delete signal type' })}
          itemLabel={t('signalTypes.deleteLabel', { defaultValue: 'this type' })}
          itemName={deleteTarget.name}
          impactText={t('signalTypes.deleteImpact', {
            defaultValue:
              'If signals already use this type it is archived instead, and open queue rows are closed. Playbook and project links are removed. Unused types are deleted.',
          })}
          isDeleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={removeType}
        />
      ) : null}

      <PageRelatedLinks
        links={[
          {
            to: inboxPath('all'),
            label: t('signalTypes.crossLinks.communicationHub', { defaultValue: 'Communication' }),
          },
          { to: '/workstreams', label: t('signalTypes.crossLinks.playbooks', { defaultValue: 'Playbooks' }) },
          {
            to: '/settings/communication',
            label: t('signalTypes.crossLinks.communication', { defaultValue: 'AI replies and triage' }),
          },
        ]}
      />
    </PageContent>
  )
}

/** What it is, what we do, where it lands — plus the gates operators rarely touch. */
function SignalTypeEditor({
  row,
  bindings,
  projects,
  workstreams,
  onSaved,
  onDelete,
}: {
  row: CaseTypeRow
  bindings: CaseBindingRow[]
  projects: ProjectRow[]
  workstreams: WorkstreamRow[]
  onSaved: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('nav')
  const playbookBinding = bindings.find((b) => b.target_kind === 'workstream') ?? null

  const [name, setName] = useState(row.name)
  const [description, setDescription] = useState(row.description)
  const [playbookId, setPlaybookId] = useState<string>(playbookBinding?.target_id ?? '')
  const [autoStartRun, setAutoStartRun] = useState(Boolean(playbookBinding?.auto_start_run))
  const [projectId, setProjectId] = useState<string>(row.default_project_id ?? '')
  const [createMode, setCreateMode] = useState<CaseCreateMode>(row.create_mode)
  const [audience, setAudience] = useState<CaseTypeRow['audience']>(row.audience)
  const [requiresVerification, setRequiresVerification] = useState(row.requires_verification)
  const [showGates, setShowGates] = useState(false)
  const [saving, setSaving] = useState(false)

  const effectivePlaybook = playbookId
  const dirty =
    name !== row.name ||
    description !== row.description ||
    effectivePlaybook !== (playbookBinding?.target_id ?? '') ||
    autoStartRun !== Boolean(playbookBinding?.auto_start_run) ||
    projectId !== (row.default_project_id ?? '') ||
    createMode !== row.create_mode ||
    audience !== row.audience ||
    requiresVerification !== row.requires_verification

  const save = async () => {
    setSaving(true)
    try {
      await patchCaseType(row.id, {
        name,
        description,
        default_project_id: projectId || null,
        create_mode: createMode,
        audience,
        requires_verification: requiresVerification,
      })
      // One playbook per type: replace the binding rather than stacking routes,
      // so a case never has to ask which of two playbooks to run.
      const changed =
        effectivePlaybook !== (playbookBinding?.target_id ?? '') ||
        autoStartRun !== Boolean(playbookBinding?.auto_start_run)
      if (changed && playbookBinding) await deleteCaseBinding(playbookBinding.id)
      if (changed && effectivePlaybook) {
        await createCaseBinding({
          case_type_id: row.id,
          target_kind: 'workstream',
          target_id: effectivePlaybook,
          auto_link: true,
          auto_start_run: autoStartRun,
        })
      }
      onSaved()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('signalTypes.saveError', { defaultValue: 'Could not update the type.' })),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 border-t border-border/60 bg-bg-elevated/30 px-3 py-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-text-muted">
          {t('signalTypes.whatItIs', { defaultValue: 'What it is' })}
        </p>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-sm"
          aria-label={t('signalTypes.nameLabel', { defaultValue: 'Name' })}
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="text-sm"
          placeholder={t('signalTypes.descriptionPlaceholder', {
            defaultValue: 'When this applies, and when it does not. Agents read this to classify.',
          })}
        />
      </div>

      <div className="space-y-3 border-t border-border/60 pt-4">
        <p className="text-xs font-semibold text-text-muted">
          {t('signalTypes.whatWeDo', { defaultValue: 'What we do' })}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor={`playbook-${row.id}`} className="mb-1 block text-xs font-medium">
              {t('signalTypes.playbookLabel', { defaultValue: 'Playbook' })}
            </Label>
            <Select
              value={playbookId || NONE}
              onValueChange={(v) => setPlaybookId(v === NONE ? '' : v)}
            >
              <SelectTrigger id={`playbook-${row.id}`} className="h-8 w-56 text-xs">
                <SelectValue
                  placeholder={t('signalTypes.playbookPlaceholder', { defaultValue: 'Pick a playbook' })}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {t('signalTypes.noPlaybook', { defaultValue: 'No playbook (label only)' })}
                </SelectItem>
                {workstreams.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`project-${row.id}`} className="mb-1 block text-xs font-medium">
              {t('signalTypes.projectLabel', { defaultValue: 'Project (optional)' })}
            </Label>
            <Select value={projectId || NONE} onValueChange={(v) => setProjectId(v === NONE ? '' : v)}>
              <SelectTrigger id={`project-${row.id}`} className="h-8 w-56 text-xs">
                <SelectValue placeholder={t('signalTypes.noProject', { defaultValue: 'No project' })} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {t('signalTypes.noProject', { defaultValue: 'No project' })}
                </SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-text-muted">
          {playbookId
            ? t('signalTypes.outcomeHints.ticket', {
                defaultValue:
                  'Conversations in this category become tickets that move through the stages of this playbook.',
              })
            : t('signalTypes.outcomeHints.label', {
                defaultValue: 'Labels the conversation for filtering and reporting. No ticket, no stages.',
              })}
        </p>
        {playbookId ? (
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <Switch checked={autoStartRun} onCheckedChange={setAutoStartRun} />
            {t('signalTypes.autoStartRun', { defaultValue: 'Start the playbook right away' })}
          </label>
        ) : null}
      </div>

      <div className="border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => setShowGates((prev) => !prev)}
          className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
          aria-expanded={showGates}
        >
          <ChevronDown size={13} className={cn('transition-transform', showGates && 'rotate-180')} />
          {t('signalTypes.gatesToggle', { defaultValue: 'How it gets filed' })}
        </button>
        {showGates ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor={`create-mode-${row.id}`} className="mb-1 block text-xs font-medium">
                {t('signalTypes.createModeLabel', { defaultValue: 'When the AI recognizes it' })}
              </Label>
              <Select value={createMode} onValueChange={(v) => setCreateMode(v as CaseCreateMode)}>
                <SelectTrigger id={`create-mode-${row.id}`} className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREATE_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`signalTypes.createModes.${mode}`, { defaultValue: CREATE_MODE_FALLBACK[mode] })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`audience-${row.id}`} className="mb-1 block text-xs font-medium">
                {t('signalTypes.audienceLabel', { defaultValue: 'Audience' })}
              </Label>
              <Select value={audience} onValueChange={(v) => setAudience(v as CaseTypeRow['audience'])}>
                <SelectTrigger id={`audience-${row.id}`} className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`signalTypes.audiences.${value}`, { defaultValue: AUDIENCE_FALLBACK[value] })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex h-8 items-center gap-2 text-xs text-text-secondary">
              <Switch checked={requiresVerification} onCheckedChange={setRequiresVerification} />
              {t('signalTypes.needsVerify', { defaultValue: 'needs confirmation' })}
            </label>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-status-error hover:text-status-error"
          onClick={onDelete}
          disabled={Boolean(row.module_slug)}
          title={
            row.module_slug
              ? t('signalTypes.moduleNoDelete', { defaultValue: 'Module types cannot be deleted here.' })
              : undefined
          }
        >
          <Trash2 size={13} className="mr-1" />
          {t('signalTypes.delete', { defaultValue: 'Delete' })}
        </Button>
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving
            ? t('signalTypes.saving', { defaultValue: 'Saving...' })
            : t('signalTypes.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  )
}

function BacklogRow({
  entry,
  onChanged,
}: {
  entry: SignalBacklogEntry
  onChanged: () => void
}) {
  const { t } = useTranslation('nav')
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(message)
      onChanged()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('signalTypes.backlogError', { defaultValue: 'Could not update the backlog.' })),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border border-border/40 bg-bg-elevated/40 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium text-text-heading">
            <span className="truncate-fade">{entry.name}</span>
            <Badge variant={entry.ready ? 'accent' : 'outline'} className="text-2xs">
              {t('signalTypes.backlogCount', { defaultValue: 'seen {{count}}x', count: entry.count })}
            </Badge>
          </p>
          {entry.sentence ? (
            <p className="mt-0.5 text-xs text-text-muted">{entry.sentence}</p>
          ) : null}
          {entry.examples[0] ? (
            <p className="mt-1 border-l-2 border-border/60 pl-2 text-xs italic text-text-secondary">
              {entry.examples[0]}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={entry.ready ? 'default' : 'outline'}
            disabled={busy}
            onClick={() =>
              void act(
                () => promoteSignalBacklog(entry.key),
                t('signalTypes.backlogPromoted', { defaultValue: 'Type created.' }),
              )
            }
          >
            <Plus size={13} className="mr-1" />
            {t('signalTypes.backlogPromote', { defaultValue: 'Make it a type' })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(
                () => dismissSignalBacklog(entry.key),
                t('signalTypes.backlogDismissed', { defaultValue: 'Removed from the backlog.' }),
              )
            }
          >
            {t('signalTypes.backlogDismiss', { defaultValue: 'Not a type' })}
          </Button>
        </div>
      </div>
    </li>
  )
}

function CreateSignalTypeDialog({
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
  const [busy, setBusy] = useState(false)

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await createCaseType({ name: trimmed, description })
      setName('')
      setDescription('')
      onCreated()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(err, t('signalTypes.createError', { defaultValue: 'Could not create the type.' })),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('signalTypes.newType', { defaultValue: 'New type' })}</DialogTitle>
          <DialogDescription>
            {t('signalTypes.newTypeHint', {
              defaultValue: 'Describe exactly when this applies, so agents recognize it in a conversation.',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('signalTypes.namePlaceholder', { defaultValue: 'Refund request' })}
            autoFocus
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="text-sm"
            placeholder={t('signalTypes.descriptionPlaceholder', {
              defaultValue: 'When this applies, and when it does not. Agents read this to classify.',
            })}
          />
          <p className="flex items-start gap-1.5 text-xs text-text-muted">
            <Inbox size={13} className="mt-0.5 shrink-0" aria-hidden />
            {t('signalTypes.newTypeFooter', {
              defaultValue: 'You can pick a playbook and project after creating the type.',
            })}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('signalTypes.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="button" disabled={busy || !name.trim()} onClick={() => void create()}>
            {t('signalTypes.createType', { defaultValue: 'Add type' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
