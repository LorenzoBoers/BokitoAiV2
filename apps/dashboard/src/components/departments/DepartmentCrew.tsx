import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Building2, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { ChoiceSelect, type ChoiceGroup } from '../ui/ChoiceSelect'
import { EmptyState } from '../ui/empty-state'
import { Input } from '../ui/input'
import { SectionHeading } from '../ui/section-heading'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useConfirm } from '../ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Callout } from '../ui/callout'
import { useAuth } from '../../context/AuthContext'
import { DEPARTMENTS_PATH, newSubDepartmentPath } from '../../lib/navigation'
import { platformIcon } from '../../lib/platform-icons'
import { cn } from '../../lib/utils'
import {
  getTeamOverview,
  setDepartmentCrew,
  type CrewEntry,
  type CrewRole,
  type DepartmentCrewRow,
  type DepartmentOverview,
  type TeamOverview,
} from '../../lib/teams-api'

const FOCUS_MAX = 80
const MAX_DEPTH = 2

function CrewAvatar({ row, size = 24 }: { row: Pick<DepartmentCrewRow, 'kind' | 'id' | 'name'> & Partial<DepartmentCrewRow>; size?: number }) {
  return row.kind === 'agent' ? (
    <Avatar kind="agent" agent={row} fallbackName={row.name} size={size} decorative mode="static" />
  ) : (
    <Avatar kind="person" name={row.name} email={row.name} size={size} decorative />
  )
}

/** Breadcrumb from the organization, then who sits on this department, with one Edit button. */
/** Path from the organization down to this department; nothing on the organization itself. */
export function DepartmentPath({ data }: { data: DepartmentOverview }) {
  const { t } = useTranslation('nav')
  if (data.path.length < 2) return null
  return (
    <nav aria-label={t('departmentPage.crew.path')} className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
      {data.path.map((step, index) => (
        <span key={step.id} className="inline-flex items-center gap-1">
          {index > 0 ? <ChevronRight size={12} className="opacity-60" aria-hidden /> : null}
          {index === data.path.length - 1 ? (
            <span className="text-text-secondary">{step.name}</span>
          ) : (
            <Link to={step.href} className="transition-colors hover:text-accent">
              {step.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}

export function CrewBand({
  data,
  canEdit,
  onEdit,
}: {
  data: DepartmentOverview
  canEdit: boolean
  onEdit: () => void
}) {
  const { t } = useTranslation('nav')
  const seats = [...data.crew].sort((a, b) => rank(a) - rank(b))
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-y border-border/60 py-2.5"
      data-testid="department-crew-band"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        {seats.length === 0 && data.admins.length === 0 ? (
          <p className="text-xs text-text-muted">
            {t('departmentPage.crew.empty' /* design-system-ignore: inline status in the crew band, not a list */)}
          </p>
        ) : null}
        {seats.map((row) => (
          <span
            key={`${row.kind}:${row.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-text-secondary"
            title={row.focus || undefined}
          >
            <CrewAvatar row={row} />
            <span className="max-w-[10rem] truncate text-text-primary">{row.name}</span>
            {row.role !== 'member' ? (
              <Badge size="sm" variant={row.role === 'contact' ? 'ai' : 'neutral'}>
                {t(`departmentPage.crew.role.${row.role}`)}
                {row.role === 'contact' && data.contact?.implicit ? ` · ${t('departmentPage.crew.implicit')}` : ''}
              </Badge>
            ) : null}
          </span>
        ))}
        {data.admins.map((row) => (
          <span key={`admin:${row.id}`} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
            <CrewAvatar row={row} />
            <span className="max-w-[10rem] truncate text-text-primary">{row.name}</span>
            <Badge size="sm" variant="neutral">
              {t(`departmentPage.crew.workspaceRole.${row.workspace_role ?? 'admin'}`)}
            </Badge>
          </span>
        ))}
        {data.is_org && !data.crew.some((r) => r.role === 'contact') && data.contact ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
            <CrewAvatar row={{ kind: 'agent', ...data.contact }} />
            <span className="max-w-[10rem] truncate text-text-primary">{data.contact.name}</span>
            <Badge size="sm" variant="ai">
              {t('departmentPage.crew.role.contact')} · {t('departmentPage.crew.implicit')}
            </Badge>
          </span>
        ) : null}
      </div>
      {canEdit ? (
        <Button type="button" size="xs" variant="ghost" className="shrink-0" onClick={onEdit} data-testid="department-crew-edit">
          <Pencil size={14} aria-hidden />
          {t('departmentPage.crew.edit')}
        </Button>
      ) : null}
    </div>
  )
}

function rank(row: DepartmentCrewRow): number {
  if (row.role === 'contact') return 0
  if (row.role === 'accountable') return 1
  return row.kind === 'agent' ? 2 : 3
}

type Draft = CrewEntry & { name: string; mark: Partial<DepartmentCrewRow> }

function draftsFrom(data: DepartmentOverview): Draft[] {
  return data.crew.map((row) => ({
    kind: row.kind,
    id: row.id,
    // An implicit contact is not stored as one; saving should not make it explicit.
    role: row.role === 'contact' && data.contact?.implicit ? 'member' : row.role,
    focus: row.focus ?? '',
    name: row.name,
    mark: row,
  }))
}

/** Edit the crew deliberately: add people and agents, pick the point of contact and the accountable person. */
export function DepartmentCrewDialog({
  data,
  open,
  onOpenChange,
  onSaved,
}: {
  data: DepartmentOverview
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Draft[]>(() => draftsFrom(data))
  const [team, setTeam] = useState<TeamOverview | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setRows(draftsFrom(data))
  }, [open, data])

  useEffect(() => {
    if (open && token && !team) void getTeamOverview(token).then(setTeam).catch(() => setTeam(null))
  }, [open, token, team])

  const seated = useMemo(() => new Set(rows.map((r) => `${r.kind}:${r.id}`)), [rows])
  const groups: ChoiceGroup[] = useMemo(() => {
    if (!team) return []
    const adminIds = new Set(data.admins.map((a) => a.id))
    return [
      {
        label: t('departmentPage.crew.agents'),
        items: team.agents
          .filter((a) => !a.deactivated && !seated.has(`agent:${a.id}`))
          .map((a) => ({ value: `agent:${a.id}`, label: a.name, kind: 'agent' as const, agent: a })),
      },
      {
        label: t('departmentPage.crew.people'),
        items: team.people
          .filter((p) => !p.deactivated && !seated.has(`user:${p.uuid}`) && !adminIds.has(p.uuid))
          .map((p) => ({
            value: `user:${p.uuid}`,
            label: p.name,
            kind: 'person' as const,
            person: { name: p.name, email: p.email, avatarUrl: p.avatar_url },
          })),
      },
    ]
  }, [team, seated, data.admins, t])

  const add = (value: string) => {
    const [kind, id] = value.split(':') as ['user' | 'agent', string]
    const agent = kind === 'agent' ? team?.agents.find((a) => a.id === id) : undefined
    const person = kind === 'user' ? team?.people.find((p) => p.uuid === id) : undefined
    const name = agent?.name ?? person?.name ?? id
    setRows((cur) => [...cur, { kind, id, role: 'member', focus: '', name, mark: agent ?? {} }])
  }

  const setRole = (index: number, role: CrewRole) =>
    setRows((cur) =>
      cur.map((row, i) => {
        if (i === index) return { ...row, role }
        // One point of contact and one accountable person: the previous one becomes a member.
        if (role !== 'member' && row.role === role) return { ...row, role: 'member' }
        return row
      }),
    )

  const explicitContact = (list: Draft[]) => list.find((r) => r.role === 'contact')?.id ?? null

  const save = async () => {
    if (!token) return
    const before = data.contact && !data.contact.implicit ? data.contact.id : null
    const after = explicitContact(rows)
    if (before !== after) {
      const nextName = rows.find((r) => r.id === after)?.name
      const ok = await confirm({
        title: t('departmentPage.crew.contactConfirmTitle'),
        description: nextName
          ? t('departmentPage.crew.contactConfirm', { name: nextName })
          : t('departmentPage.crew.contactConfirmNone'),
        confirmLabel: t('departmentPage.crew.save'),
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const result = await setDepartmentCrew(
        token,
        data.id,
        rows.map(({ kind, id, role, focus }) => ({ kind, id, role, focus: focus.trim().slice(0, FOCUS_MAX) })),
      )
      onOpenChange(false)
      onSaved()
      toast.success(t('departmentPage.crew.saved'), {
        action: {
          label: t('departmentPage.crew.undo'),
          onClick: () => {
            void setDepartmentCrew(token, data.id, result.previous)
              .then(onSaved)
              .catch((err) => toast.error(err instanceof Error ? err.message : t('departmentPage.crew.saveError')))
          },
        },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('departmentPage.crew.saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="department-crew-dialog">
        <DialogHeader>
          <DialogTitle>{t('departmentPage.crew.title', { name: data.name })}</DialogTitle>
          <DialogDescription>
            {data.is_org ? t('departmentPage.crew.hintOrg') : t('departmentPage.crew.hint')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {data.is_org ? (
            <>
              <Callout tone="warning">{t('departmentPage.crew.orgWarning')}</Callout>
              {data.admins.length > 0 ? (
                <p className="text-xs text-text-muted">
                  {t('departmentPage.crew.adminsLine', { names: data.admins.map((row) => row.name).join(', ') })}
                </p>
              ) : null}
            </>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState tone="dashed" size="sm" title={t('departmentPage.crew.emptyEdit')} />
          ) : (
            <ul className="divide-y divide-border/50 rounded-lg border border-border">
              {rows.map((row, index) => (
                <li key={`${row.kind}:${row.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <CrewAvatar row={{ kind: row.kind, id: row.id, name: row.name, ...row.mark }} size={22} />
                  <span className="min-w-[7rem] flex-1 truncate text-sm text-text-primary">{row.name}</span>
                  <Select value={row.role} onValueChange={(value) => setRole(index, value as CrewRole)}>
                    <SelectTrigger className="h-8 w-40" aria-label={t('departmentPage.crew.roleLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={row.kind === 'agent' ? 'contact' : 'accountable'}>
                        {t(`departmentPage.crew.role.${row.kind === 'agent' ? 'contact' : 'accountable'}`)}
                      </SelectItem>
                      <SelectItem value="member">{t('departmentPage.crew.role.member')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={row.focus}
                    maxLength={FOCUS_MAX}
                    onChange={(event) =>
                      setRows((cur) => cur.map((r, i) => (i === index ? { ...r, focus: event.target.value } : r)))
                    }
                    placeholder={t('departmentPage.crew.focusPlaceholder')}
                    aria-label={t('departmentPage.crew.focusLabel')}
                    className="h-8 w-full sm:w-56"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-text-muted"
                    aria-label={t('departmentPage.crew.remove', { name: row.name })}
                    onClick={() => setRows((cur) => cur.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ChoiceSelect
            groups={groups}
            value=""
            onValueChange={add}
            placeholder={t('departmentPage.crew.add')}
            aria-label={t('departmentPage.crew.add')}
            disabled={!team}
          />
          <p className="text-xs text-text-muted">{t('departmentPage.crew.contactHint')}</p>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {t('teamPage.cancel')}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {t('departmentPage.crew.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The departments directly below, each with its point of contact and open tickets. */
export function SubDepartments({ data, canEdit = false }: { data: DepartmentOverview; canEdit?: boolean }) {
  const { t } = useTranslation('nav')
  // The path runs from the organization to this node; departments go two levels below it.
  const canAdd = canEdit && data.path.length - 1 < MAX_DEPTH
  if (data.children.length === 0 && !canAdd) return null
  if (data.children.length === 0) {
    return (
      <Link
        to={data.is_org ? `${DEPARTMENTS_PATH}&new=1` : newSubDepartmentPath(data.id)}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
        data-testid="new-sub-department"
      >
        <Plus size={14} aria-hidden />
        {data.is_org ? t('teamPage.newTeam') : t('departmentPage.children.new')}
      </Link>
    )
  }
  return (
    <section className="space-y-3" data-testid="department-children">
      <SectionHeading
        title={data.is_org ? t('departmentPage.children.titleOrg') : t('departmentPage.children.title')}
        actions={
          canAdd ? (
            <Button type="button" size="xs" variant="secondary" asChild>
              <Link to={data.is_org ? `${DEPARTMENTS_PATH}&new=1` : newSubDepartmentPath(data.id)} data-testid="new-sub-department">
                <Plus size={14} aria-hidden />
                {data.is_org ? t('teamPage.newTeam') : t('departmentPage.children.new')}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.children.map((child) => {
          const Icon = platformIcon(child.icon) ?? Building2
          return (
            <Link key={child.id} to={child.href} className="group">
              <Card className={cn('flex items-center gap-3 p-4 transition-colors group-hover:border-accent/40')}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon size={18} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-heading">{child.name}</p>
                  <p className="truncate text-2xs text-text-muted">
                    {child.contact
                      ? t('departmentPage.children.contact', { name: child.contact.name })
                      : t('departmentPage.children.noContact' /* design-system-ignore: field value on a row */)}
                  </p>
                </div>
                {child.contact ? (
                  <Avatar kind="agent" agent={child.contact} fallbackName={child.contact.name} size={24} decorative mode="static" />
                ) : null}
                <Badge size="sm">{t('departmentPage.children.open', { count: child.open })}</Badge>
              </Card>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
