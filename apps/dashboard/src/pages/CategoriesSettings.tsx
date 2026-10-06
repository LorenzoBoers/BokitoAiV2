/**
 * Action tags (`/settings/action-tags`): hashtags that start a flow, plus the free hashtags.
 *
 * A conversation carries at most one action tag; filing it makes the
 * conversation a ticket in that flow's stages. Interpretation reads every
 * inbound message against these action tags and never invents one; patterns it
 * keeps seeing land in the backlog at the bottom.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, Plus, Radar, ShieldCheck, Users } from 'lucide-react'
import PageContent from '../components/layout/PageContent'
import { PageIntro } from '../components/layout/PageIntro'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { TagRegistrySection } from '../components/inbox/TagRegistrySection'
import { AutosaveStatus } from '../components/ui/AutosaveStatus'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useAutosave } from '../hooks/useAutosave'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { EmptyState } from '../components/ui/empty-state'
import { Hashtag, HashtagMark } from '../components/ui/HashtagMark'
import { Label } from '../components/ui/label'
import { LoadingBlock } from '../components/ui/loading-block'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Textarea } from '../components/ui/textarea'
import { useAuth } from '../context/AuthContext'
import { normalizeHashtag, stripHash } from '../lib/hashtag'
import { inboxPath } from '../lib/messages-paths'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listSignalTags, type SignalTag } from '../lib/signals-api'
import {
  createCategory,
  dismissSignalBacklog,
  getSignalPolicy,
  listCategories,
  listSignalBacklog,
  patchCategory,
  promoteSignalBacklog,
  saveSignalPolicy,
  type CategoryCreateMode,
  type CategoryRow,
  type SignalAcceptRoles,
  type SignalBacklogEntry,
  type SignalPolicy,
} from '../lib/tickets-api'
import { listWorkstreams, type WorkstreamRow } from '../lib/workstreams-api'
import { workstreamPath } from '../lib/workstream-ui'
import { cn } from '../lib/utils'

const NEW_PLAYBOOK = '__new__'

const CREATE_MODES: CategoryCreateMode[] = ['ask_customer', 'ask_operator', 'auto', 'manual_only']

type CatalogData = {
  categories: CategoryRow[]
  projects: ProjectRow[]
  workstreams: WorkstreamRow[]
}

export default function CategoriesSettings() {
  const { t } = useTranslation('nav')
  const [data, setData] = useState<CatalogData | null>(null)
  const [policy, setPolicy] = useState<SignalPolicy | null>(null)
  const [backlog, setBacklog] = useState<SignalBacklogEntry[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [savingPolicy, setSavingPolicy] = useState(false)

  const load = useCallback(async () => {
    const [categories, projects, workstreams] = await Promise.all([
      listCategories(),
      listProjects().catch(() => [] as ProjectRow[]),
      listWorkstreams().catch(() => [] as WorkstreamRow[]),
    ])
    setData({ categories, projects, workstreams })
  }, [])

  const loadBacklog = useCallback(async () => {
    const res = await listSignalBacklog().catch(() => ({ items: [], threshold: 3 }))
    setBacklog(res.items)
  }, [])

  useEffect(() => {
    void load().catch((err) => toast.error(formatApiErrorMessage(err, t('categoriesPage.loadError'))))
    void getSignalPolicy().then(setPolicy).catch(() => setPolicy(null))
    void loadBacklog()
  }, [load, loadBacklog, t])

  const projectNames = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.id, p.name])), [data])

  const savePolicy = async (patch: { accept_roles?: SignalAcceptRoles; backlog_threshold?: number }) => {
    setSavingPolicy(true)
    try {
      setPolicy(await saveSignalPolicy(patch))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('categoriesPage.policyError')))
    } finally {
      setSavingPolicy(false)
    }
  }

  const toggleNav = async (row: CategoryRow, show: boolean) => {
    try {
      await patchCategory(row.id, { show_in_nav: show })
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('categoriesPage.saveError')))
    }
  }

  const summaryLine = (row: CategoryRow): string => {
    const ws = data?.workstreams.find((w) => w.id === row.workstream_id)
    const projects = (ws?.project_ids ?? []).map((id) => projectNames.get(id)).filter(Boolean)
    const parts = [row.workstream_name || ws?.name || t('categoriesPage.playbook')]
    parts.push(projects.length > 0 ? projects.join(', ') : t('categoriesPage.noProjects'))
    parts.push(t('categoriesPage.openCount', { open: row.open, waiting: row.waiting }))
    return parts.join(' · ')
  }

  return (
    <PageContent width="md" className="space-y-6">
      <PageIntro description={t('categoriesPage.intro')} />

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-text-heading">{t('categoriesPage.catalogTitle')}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{t('categoriesPage.catalogDescription')}</p>
          </div>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} className="mr-1" />
            {t('categoriesPage.newCategory')}
          </Button>
        </div>

        {!data ? (
          <LoadingBlock variant="inline" label={t('categoriesPage.loading')} />
        ) : data.categories.length === 0 ? (
          <EmptyState
            icon={Radar}
            title={t('categoriesPage.emptyTitle')}
            description={t('categoriesPage.emptyBody')}
            action={
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                {t('categoriesPage.newCategory')}
              </Button>
            }
          />
        ) : (
          <ul className="space-y-1.5">
            {data.categories.map((row) => {
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
                        <Hashtag name={row.name} category className="text-sm font-medium text-text-heading" />
                        {row.module_slug ? (
                          <Badge variant="outline" className="text-2xs">
                            {row.module_slug}
                          </Badge>
                        ) : null}
                        {row.requires_verification ? (
                          <span title={t('categoriesPage.needsVerify')}>
                            <ShieldCheck size={13} className="text-status-success" aria-hidden />
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate-fade text-xs text-text-muted">
                        {row.description?.trim() ? row.description : t('categoriesPage.noDescription')}
                      </span>
                      <span className="mt-0.5 block truncate-fade text-xs text-text-secondary">
                        {summaryLine(row)}
                      </span>
                    </span>
                    <label
                      className="flex shrink-0 items-center gap-2 text-xs text-text-muted"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('categoriesPage.showInNav')}
                      <Switch checked={row.show_in_nav} onCheckedChange={(v) => void toggleNav(row, v)} />
                    </label>
                    <ChevronDown
                      size={16}
                      className={cn('shrink-0 text-text-muted transition-transform', expanded && 'rotate-180')}
                    />
                  </div>
                  {expanded ? (
                    <CategoryEditor
                      key={row.id}
                      row={row}
                      workstreams={data.workstreams}
                      onSaved={() => void load()}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Card className="overflow-hidden p-0">
        <TagRegistrySection freeOnly onChanged={() => void load()} />
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-medium text-text-heading">{t('categoriesPage.backlogTitle')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t('categoriesPage.backlogDescription')}</p>
        </div>
        {backlog.length === 0 ? (
          <p className="text-xs text-text-muted">{t('categoriesPage.backlogEmpty')}</p>
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

      <Card className="space-y-5 p-5">
        <div>
          <h2 className="text-sm font-medium text-text-heading">{t('categoriesPage.policyTitle')}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t('categoriesPage.policyDescription')}</p>
        </div>
        {!policy ? (
          <LoadingBlock variant="inline" label={t('categoriesPage.loading')} />
        ) : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Users size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="signal-accept-roles" className="text-sm font-medium">
                    {t('categoriesPage.acceptRolesLabel')}
                  </Label>
                  <p className="mt-0.5 max-w-sm text-xs text-text-muted">{t('categoriesPage.acceptRolesHint')}</p>
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
                  <SelectItem value="admins">{t('categoriesPage.acceptAdmins')}</SelectItem>
                  <SelectItem value="members">{t('categoriesPage.acceptMembers')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-5">
              <div className="flex items-start gap-3">
                <Radar size={16} className="mt-0.5 text-accent" />
                <div>
                  <Label htmlFor="signal-backlog-threshold" className="text-sm font-medium">
                    {t('categoriesPage.thresholdLabel')}
                  </Label>
                  <p className="mt-0.5 max-w-sm text-xs text-text-muted">{t('categoriesPage.thresholdHint')}</p>
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
                      {t('categoriesPage.thresholdOption', { count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </Card>

      <CreateCategoryDialog
        open={createOpen}
        workstreams={data?.workstreams ?? []}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          void load()
        }}
      />

      <PageRelatedLinks
        links={[
          { to: inboxPath('all'), label: t('categoriesPage.crossLinks.communicationHub') },
          { to: '/workstreams', label: t('categoriesPage.crossLinks.playbooks') },
        ]}
      />
    </PageContent>
  )
}

/** Description, playbook and filing gates of one category. */
function CategoryEditor({
  row,
  workstreams,
  onSaved,
}: {
  row: CategoryRow
  workstreams: WorkstreamRow[]
  onSaved: () => void
}) {
  const { t } = useTranslation('nav')
  const [description, setDescription] = useState(row.description)
  const [playbookId, setPlaybookId] = useState(row.workstream_id)
  const [createMode, setCreateMode] = useState<CategoryCreateMode>(row.create_mode)
  const [requiresVerification, setRequiresVerification] = useState(row.requires_verification)
  const [showGates, setShowGates] = useState(false)
  const [detaching, setDetaching] = useState(false)

  const dirty =
    description !== row.description ||
    playbookId !== row.workstream_id ||
    createMode !== row.create_mode ||
    requiresVerification !== row.requires_verification

  useEffect(() => {
    if (dirty) return
    setDescription(row.description)
    setPlaybookId(row.workstream_id)
    setCreateMode(row.create_mode)
    setRequiresVerification(row.requires_verification)
  }, [row.id, row.description, row.workstream_id, row.create_mode, row.requires_verification, dirty])

  const save = useCallback(async () => {
    try {
      await patchCategory(row.id, {
        description,
        workstream_id: playbookId,
        create_mode: createMode,
        requires_verification: requiresVerification,
      })
      onSaved()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('categoriesPage.saveError')))
      throw err
    }
  }, [row.id, description, playbookId, createMode, requiresVerification, onSaved, t])

  const { phase, lastSavedAt, error } = useAutosave({
    dirty,
    enabled: true,
    canSave: Boolean(playbookId),
    save,
  })

  const detach = async () => {
    setDetaching(true)
    try {
      await patchCategory(row.id, { workstream_id: null })
      onSaved()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('categoriesPage.saveError')))
    } finally {
      setDetaching(false)
    }
  }

  return (
    <div className="space-y-4 border-t border-border/60 bg-bg-elevated/30 px-3 py-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-text-muted">{t('categoriesPage.whatItIs')}</p>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="text-sm"
          placeholder={t('categoriesPage.descriptionPlaceholder')}
        />
      </div>

      <div className="space-y-2 border-t border-border/60 pt-4">
        <Label htmlFor={`playbook-${row.id}`} className="block text-xs font-semibold text-text-muted">
          {t('categoriesPage.playbook')}
        </Label>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={playbookId} onValueChange={setPlaybookId}>
            <SelectTrigger id={`playbook-${row.id}`} className="h-8 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workstreams.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link to={workstreamPath(row.workstream_id)} className="text-xs font-medium text-accent hover:underline">
            {t('categoriesPage.openPlaybook')}
          </Link>
        </div>
        <p className="text-xs text-text-muted">{t('categoriesPage.playbookHint')}</p>
      </div>

      <div className="border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => setShowGates((prev) => !prev)}
          className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
          aria-expanded={showGates}
        >
          <ChevronDown size={13} className={cn('transition-transform', showGates && 'rotate-180')} />
          {t('categoriesPage.gatesToggle')}
        </button>
        {showGates ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor={`create-mode-${row.id}`} className="mb-1 block text-xs font-medium">
                {t('categoriesPage.createModeLabel')}
              </Label>
              <Select value={createMode} onValueChange={(v) => setCreateMode(v as CategoryCreateMode)}>
                <SelectTrigger id={`create-mode-${row.id}`} className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREATE_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`categoriesPage.createModes.${mode}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex h-8 items-center gap-2 text-xs text-text-secondary">
              <Switch checked={requiresVerification} onCheckedChange={setRequiresVerification} />
              {t('categoriesPage.needsVerify')}
            </label>
            <p className="basis-full text-xs text-text-muted">{t('categoriesPage.projectRule')}</p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={detaching || Boolean(row.module_slug)}
          title={row.module_slug ? t('categoriesPage.moduleNoDetach') : t('categoriesPage.detachHint')}
          onClick={() => void detach()}
        >
          {t('categoriesPage.detach')}
        </Button>
        <AutosaveStatus phase={phase} lastSavedAt={lastSavedAt} error={error} />
      </div>
    </div>
  )
}

function BacklogRow({ entry, onChanged }: { entry: SignalBacklogEntry; onChanged: () => void }) {
  const { t } = useTranslation('nav')
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(message)
      onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('categoriesPage.backlogError')))
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
              {t('categoriesPage.backlogCount', { count: entry.count })}
            </Badge>
          </p>
          {entry.sentence ? <p className="mt-0.5 text-xs text-text-muted">{entry.sentence}</p> : null}
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
            onClick={() => void act(() => promoteSignalBacklog(entry.key), t('categoriesPage.backlogPromoted'))}
          >
            <Plus size={13} className="mr-1" />
            {t('categoriesPage.backlogPromote')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void act(() => dismissSignalBacklog(entry.key), t('categoriesPage.backlogDismissed'))}
          >
            {t('categoriesPage.backlogDismiss')}
          </Button>
        </div>
      </div>
    </li>
  )
}

/** Register a hashtag (or pick an existing free one) and attach a playbook. */
function CreateCategoryDialog({
  open,
  workstreams,
  onClose,
  onCreated,
}: {
  open: boolean
  workstreams: WorkstreamRow[]
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const listId = useId()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [playbookId, setPlaybookId] = useState(NEW_PLAYBOOK)
  const [freeTags, setFreeTags] = useState<SignalTag[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !token) return
    void listSignalTags(token)
      .then((rows) => setFreeTags(rows.filter((row) => !row.isCategory)))
      .catch(() => setFreeTags([]))
  }, [open, token])

  const clean = normalizeHashtag(name)

  const create = async () => {
    if (!clean) return
    setBusy(true)
    try {
      await createCategory({
        name: clean,
        description,
        ...(playbookId === NEW_PLAYBOOK ? { playbook_name: clean } : { workstream_id: playbookId }),
      })
      setName('')
      setDescription('')
      setPlaybookId(NEW_PLAYBOOK)
      onCreated()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('categoriesPage.createError')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('categoriesPage.newCategory')}</DialogTitle>
          <DialogDescription>{t('categoriesPage.newCategoryHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex h-9 items-center rounded-md border border-border bg-bg-input pl-2.5 focus-within:border-accent/60">
            <HashtagMark category className="text-sm" />
            <input
              value={name}
              list={listId}
              onChange={(e) => setName(stripHash(e.target.value))}
              placeholder={t('categoriesPage.namePlaceholder')}
              aria-label={t('categoriesPage.nameLabel')}
              className="h-full min-w-0 flex-1 bg-transparent pl-0.5 pr-2.5 text-sm text-text-primary focus:outline-none"
              autoFocus
            />
            <datalist id={listId}>
              {freeTags.map((tag) => (
                <option key={tag.id} value={tag.name} />
              ))}
            </datalist>
          </div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="text-sm"
            placeholder={t('categoriesPage.descriptionPlaceholder')}
          />
          <div className="space-y-1">
            <Label htmlFor="new-category-playbook" className="text-xs font-medium">
              {t('categoriesPage.playbook')}
            </Label>
            <Select value={playbookId} onValueChange={setPlaybookId}>
              <SelectTrigger id="new-category-playbook" className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_PLAYBOOK}>
                  {t('categoriesPage.newPlaybook', { name: clean ? `#${clean}` : '' })}
                </SelectItem>
                {workstreams.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('categoriesPage.cancel')}
          </Button>
          <Button type="button" disabled={busy || !clean} onClick={() => void create()}>
            {t('categoriesPage.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
