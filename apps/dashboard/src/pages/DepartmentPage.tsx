import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Bell, Building2, FolderOpen, PhoneCall, Settings } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { OpenInGridButton } from '../components/org/OpenInGridButton'
import { DepartmentFlowPipeline } from '../components/departments/DepartmentFlowPipeline'
import { ProjectAgendaCard } from '../components/projects/ProjectAgendaCard'
import { ProjectDocs } from '../components/projects/ProjectDocs'
import { ProjectFlowBoards } from '../components/projects/ProjectFlowBoards'
import { WorksInSection } from '../components/projects/WorksInSection'
import { Card } from '../components/ui/card'
import { PageHeader } from '../components/ui/page-header'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { AgentMark } from '../components/ui/AgentMark'
import { UserAvatar } from '../components/ui/UserAvatar'
import { EmptyState } from '../components/ui/empty-state'
import { SectionHeading } from '../components/ui/section-heading'
import { StatGrid, StatTile } from '../components/ui/stat-tile'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Tip } from '../components/ui/Tip'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { useAuth } from '../context/AuthContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { filterPlatformIcons, platformIcon } from '../lib/platform-icons'
import { inboxPath } from '../lib/messages-paths'
import { GRID_ICON } from '../lib/navigation'
import { cn } from '../lib/utils'
import {
  answerDomainQuestion,
  getDepartmentOverview,
  patchDepartmentAwareness,
  patchTeam,
  type DepartmentAwareness,
  type DepartmentBottleneck,
  type DepartmentFlow,
  type DepartmentOverview,
  type DepartmentQuestion,
} from '../lib/teams-api'

const ALL = 'all'

/** The department mark next to the title; owners and admins click it to pick another icon. */
function DepartmentIcon({
  icon,
  canEdit,
  onPick,
}: {
  icon: string
  canEdit: boolean
  onPick: (icon: string) => Promise<void>
}) {
  const { t } = useTranslation('nav')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const iconIds = useMemo(() => filterPlatformIcons(query, icon), [query, icon])
  const Current = platformIcon(icon) ?? Building2
  const tile = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent'
  if (!canEdit) {
    return (
      <span className={tile}>
        <Current size={22} aria-hidden />
      </span>
    )
  }
  return (
    <>
      <Tip label={t('departmentPage.changeIcon')}>
        <Button
          type="button"
          variant="ghost"
          className={cn(tile, 'p-0 hover:border-accent/50 hover:bg-accent/15 hover:text-accent')}
          aria-label={t('departmentPage.changeIcon')}
          onClick={() => setOpen(true)}
          data-testid="department-icon"
        >
          <Current size={22} aria-hidden />
        </Button>
      </Tip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('departmentPage.iconTitle')}</DialogTitle>
            <DialogDescription>{t('departmentPage.iconBody')}</DialogDescription>
          </DialogHeader>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('workstreamsPage.mark.search')}
            aria-label={t('workstreamsPage.mark.search')}
            className="h-8"
          />
          <div className="grid max-h-[min(50vh,24rem)] grid-cols-8 gap-1 overflow-auto">
            {iconIds.map((id) => {
              const Icon = platformIcon(id)
              if (!Icon) return null
              return (
                <Button size="icon"
                  key={id}
                  type="button"
                  variant="ghost"
                  aria-pressed={icon === id}
                  aria-label={id}
                  title={id}
                  disabled={saving}
                  onClick={() => {
                    setSaving(true)
                    void onPick(id).finally(() => {
                      setSaving(false)
                      setOpen(false)
                    })
                  }}
                  className={cn('p-0 text-accent', icon === id &&'ring-1 ring-text-heading')}
                >
                  <Icon size={15} aria-hidden />
                </Button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function euros(cents: number | null | undefined): string {
  return `EUR ${((cents ?? 0) / 100).toFixed(2)}`
}

function when(iso: string | null | undefined, lang: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const PRESENCE_DOT: Record<string, string> = {
  available: 'bg-status-success',
  busy: 'bg-status-warning',
  away: 'bg-text-muted',
  offline: 'bg-border',
}

function PresenceDot({ value }: { value?: string | null }) {
  const { t } = useTranslation('nav')
  if (!value) return null
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-text-muted">
      <span className={cn('h-1.5 w-1.5 rounded-full', PRESENCE_DOT[value] ?? 'bg-border')} aria-hidden />
      {t(`departmentPage.presence.${value}`, { defaultValue: value })}
    </span>
  )
}

function SectionCard({ title, hint, testId, children }: { title: string; hint?: string; testId?: string; children: ReactNode }) {
  return (
    <Card className="space-y-3 p-5" data-testid={testId}>
      <SectionHeading title={title} description={hint} />
      {children}
    </Card>
  )
}

/** Parent department, centered between the title and the tabs, with who sits on it. */
function ParentBand({ parent }: { parent: DepartmentOverview['parent'] }) {
  const { t } = useTranslation('nav')
  if (!parent) return null
  const name = parent.is_root ? t('departmentPage.rootName') : parent.name
  return (
    <div className="flex flex-col items-center gap-2 px-4 text-center" data-testid="department-parent">
      <p className="text-sm font-semibold text-text-heading">{name}</p>
      {parent.members.length === 0 ? (
        <p className="text-xs text-text-muted">{t('departmentPage.parentEmpty')}</p>
      ) : (
        <ul className="flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {parent.members.map((member) => (
            <li key={`${member.kind}:${member.id}`} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              {member.kind === 'agent' ? (
                <AgentMark agent={member} fallbackName={member.name} size={24} decorative mode="static" />
              ) : (
                <UserAvatar name={member.name} email={member.name} size={24} decorative />
              )}
              <span className="max-w-[9rem] truncate">{member.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Bottlenecks({ items, decisions = 0 }: { items: DepartmentBottleneck[]; decisions?: number }) {
  const { t } = useTranslation('nav')
  if (items.length === 0 && !decisions) {
    return <p className="text-sm text-text-secondary">{t('departmentPage.today.calm')}</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((b) => (
        <Badge key={b.key} variant="warning">
          {t(`departmentPage.today.${b.key}`, { count: b.count })}
        </Badge>
      ))}
      {decisions ? <Badge variant="ai">{t('departmentPage.today.decisions', { count: decisions })}</Badge> : null}
    </div>
  )
}

function FlowList({ flows, empty }: { flows: DepartmentFlow[]; empty: string }) {
  const { t } = useTranslation('nav')
  return (
    <section className="space-y-3" data-testid="department-flows">
      <SectionHeading title={t('departmentPage.flows')} description={t('departmentPage.flowsHint')} />
      {flows.length === 0 ? (
        <EmptyState tone="dashed" size="sm" title={empty} />
      ) : (
        <div className="space-y-3">
          {flows.map((flow) => (
            <DepartmentFlowPipeline key={flow.id} flow={flow} />
          ))}
        </div>
      )}
    </section>
  )
}

/** What wakes the lead between orientations, and what it may spend a day. */
export function AwarenessEditor({
  awareness,
  canEdit,
  onSave,
}: {
  awareness: DepartmentAwareness
  canEdit: boolean
  onSave: (patch: Partial<DepartmentAwareness>) => Promise<void>
}) {
  const { t, i18n } = useTranslation('nav')
  const [follows, setFollows] = useState<string[]>(awareness.follows)
  const [mode, setMode] = useState(awareness.mode || 'daily')
  const [cron, setCron] = useState(awareness.cron || '30 7 * * 1-5')
  const [budget, setBudget] = useState(String((awareness.daily_cost_cents / 100).toFixed(2)))
  const [maxProposals, setMaxProposals] = useState(String(awareness.max_proposals))
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setFollows(awareness.follows)
    setMode(awareness.mode || 'daily')
    setCron(awareness.cron || '30 7 * * 1-5')
    setBudget((awareness.daily_cost_cents / 100).toFixed(2))
    setMaxProposals(String(awareness.max_proposals))
  }, [awareness])
  const modes = ['off', 'on_conversation', 'daily', 'custom'] as const
  return (
    <div className="space-y-4">
      {awareness.role ? <p className="text-sm text-text-secondary">{awareness.role}</p> : null}
      <div className="space-y-1.5">
        <p className="title-eyebrow">{t('departmentPage.awareness.mode')}</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('departmentPage.awareness.mode')}>
          {modes.map((value) => (
            <Button
              key={value}
              type="button"
              size="xs"
              variant={mode === value ? 'secondary' : 'ghost'}
              disabled={!canEdit}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn('border text-xs', mode === value ?'border-accent/60 text-text-primary':'border-border text-text-secondary')}
            >
              {t(`departmentPage.awareness.modes.${value}`)}
            </Button>
          ))}
        </div>
      </div>
      {mode === 'custom' ? (
        <label className="block space-y-1 text-xs text-text-muted">
          <span>{t('departmentPage.awareness.cron')}</span>
          <Input value={cron} disabled={!canEdit} onChange={(event) => setCron(event.target.value)} className="h-8 font-mono" />
        </label>
      ) : null}
      <div className="space-y-1.5">
        <p className="title-eyebrow">{t('departmentPage.awareness.follows')}</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('departmentPage.awareness.follows')}>
          {awareness.followable.map((kind) => {
            const on = follows.includes(kind)
            return (
              <Button
                key={kind}
                type="button"
                size="xs"
                variant={on ? 'secondary' : 'ghost'}
                disabled={!canEdit}
                aria-pressed={on}
                onClick={() => setFollows((cur) => (on ? cur.filter((k) => k !== kind) : [...cur, kind]))}
                className={cn('border text-xs', on ?'border-accent/60 text-text-primary':'border-border text-text-secondary')}
              >
                {t(`departmentPage.awareness.follow.${kind}`, { defaultValue: kind })}
              </Button>
            )
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-text-muted">
          <span>{t('departmentPage.awareness.dailyCost')}</span>
          <Input
            value={budget}
            disabled={!canEdit}
            inputMode="decimal"
            onChange={(event) => setBudget(event.target.value)}
            className="h-8"
          />
          <span className="block text-2xs">{t('departmentPage.awareness.spentToday', { amount: euros(awareness.spent_today_cents) })}</span>
        </label>
        <label className="space-y-1 text-xs text-text-muted">
          <span>{t('departmentPage.awareness.maxProposals')}</span>
          <Input
            value={maxProposals}
            disabled={!canEdit}
            inputMode="numeric"
            onChange={(event) => setMaxProposals(event.target.value)}
            className="h-8"
          />
        </label>
        <div className="space-y-1 text-xs text-text-muted">
          <span>{t('departmentPage.awareness.nextWake')}</span>
          <p className="text-sm text-text-primary">{when(awareness.next_wake_at, i18n.language) || t('departmentPage.none')}</p>
        </div>
      </div>
      {canEdit ? (
        <Button
          size="sm"
          disabled={saving}
          onClick={() => {
            setSaving(true)
            void onSave({
              follows,
              mode,
              cron: cron.trim(),
              daily_cost_cents: Math.max(0, Math.round(Number(budget.replace(',', '.')) * 100) || 0),
              max_proposals: Math.max(0, Math.min(10, Number(maxProposals) || 0)),
            }).finally(() => setSaving(false))
          }}
        >
          {t('departmentPage.awareness.save')}
        </Button>
      ) : null}
    </div>
  )
}

function DomainQuestions({
  questions,
  roomId,
  onAnswer,
}: {
  questions: DepartmentQuestion[]
  roomId: string | null
  onAnswer: (key: string, answer: string) => Promise<void>
}) {
  const { t } = useTranslation('nav')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  if (questions.length === 0) return <p className="text-sm text-text-secondary">{t('departmentPage.domain.empty')}</p>
  return (
    <ul className="divide-y divide-border/50 rounded-lg border border-border" data-testid="department-domain-questions">
      {questions.map((q) => (
        <li key={q.key} className="space-y-2 px-3 py-2.5 text-sm">
          <p className="text-text-primary">{q.question}</p>
          {q.status === 'answered' ? (
            <p className="text-xs text-text-secondary">{q.answer}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={drafts[q.key] ?? ''}
                onChange={(event) => setDrafts((cur) => ({ ...cur, [q.key]: event.target.value }))}
                placeholder={t('departmentPage.domain.placeholder')}
                aria-label={t('departmentPage.domain.placeholder')}
                className="h-8 min-w-0 flex-1"
              />
              <Button
                size="sm"
                disabled={!(drafts[q.key] ?? '').trim()}
                onClick={() => void onAnswer(q.key, (drafts[q.key] ?? '').trim())}
              >
                {t('departmentPage.domain.answer')}
              </Button>
              {q.signal_id || roomId ? (
                <Link to={inboxPath(null, q.signal_id ?? roomId ?? '')} className="shrink-0 text-xs text-accent hover:underline">
                  {t('departmentPage.domain.inThread')}
                </Link>
              ) : null}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function ChipRow({ label, items }: { label: string; items: Array<{ id: string; name: string; href?: string }> }) {
  const { t } = useTranslation('nav')
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="w-28 shrink-0 text-text-muted">{label}</span>
      {items.length === 0 ? <span className="text-text-muted">{t('departmentPage.reach.none')}</span> : null}
      {items.map((item) =>
        item.href ? (
          <Link key={item.id} to={item.href}>
            <Badge className="hover:text-accent">{item.name}</Badge>
          </Link>
        ) : (
          <Badge key={item.id}>{item.name}</Badge>
        ),
      )}
    </div>
  )
}

function TeamCard({ data }: { data: DepartmentOverview }) {
  const { t } = useTranslation('nav')
  return (
    <SectionCard title={t('departmentPage.team')} testId="department-team">
      {data.members.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('departmentPage.reach.none')}</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {data.members.map((member) => (
            <li key={`${member.kind}:${member.id}`} className="flex items-center gap-2.5 py-2 text-sm">
              {member.kind === 'agent' ? (
                <AgentMark agent={{ id: member.id, name: member.name }} fallbackName={member.name} size={24} decorative mode="static" />
              ) : (
                <UserAvatar name={member.name} email={member.name} size={24} decorative />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-text-primary">{member.name}</p>
                <p className="truncate text-2xs text-text-muted">
                  {member.kind === 'agent'
                    ? `${member.doing || t(`departmentPage.agentStatus.${member.status ?? 'standby'}`, { defaultValue: member.status ?? '' })}${
                        member.cost_cents ? ` · ${t('departmentPage.cost', { amount: euros(member.cost_cents) })}` : ''
                      }`
                    : `${t('departmentPage.openAssigned', { count: member.open_assigned ?? 0 })}${
                        member.hours_per_week != null ? ` · ${t('departmentPage.hours', { count: member.hours_per_week })}` : ''
                      }`}
                </p>
              </div>
              {member.duty !== 'member' ? (
                <Badge size="sm">{t(`departmentPage.duty.${member.duty}`, { defaultValue: member.duty })}</Badge>
              ) : null}
              {member.kind === 'user' ? <PresenceDot value={member.presence} /> : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function AllTab({
  data,
  onAnswer,
}: {
  data: DepartmentOverview
  onAnswer: (key: string, answer: string) => Promise<void>
}) {
  const { t, i18n } = useTranslation('nav')
  return (
    <div className="space-y-6">
      <StatGrid>
        <StatTile label={t('departmentPage.totals.open')} value={data.totals.open} />
        <StatTile label={t('departmentPage.totals.waiting')} value={data.totals.waiting} />
        <StatTile
          label={t('departmentPage.totals.overdue')}
          value={<span className={data.totals.overdue ? 'text-status-warning' : undefined}>{data.totals.overdue}</span>}
        />
        <StatTile label={t('departmentPage.decisions')} value={data.today.decisions_waiting} />
      </StatGrid>

      <SectionCard title={t('departmentPage.today.title')} testId="department-today">
        <Bottlenecks items={data.today.bottlenecks} decisions={data.today.decisions_waiting} />
        {data.today.orientation ? (
          <div className="space-y-1 rounded-md border border-border bg-bg-elevated/50 px-3 py-2.5">
            <p className="text-2xs text-text-muted">
              {t('departmentPage.today.orientation', { when: when(data.today.orientation.at, i18n.language) })}
            </p>
            <p className="whitespace-pre-line text-sm text-text-primary">
              {data.today.orientation.quiet || !data.today.orientation.summary
                ? t('departmentPage.today.quiet')
                : data.today.orientation.summary}
            </p>
          </div>
        ) : (
          <p className="text-xs text-text-secondary">{t('departmentPage.today.noOrientation')}</p>
        )}
      </SectionCard>

      <FlowList flows={data.flows} empty={t('departmentPage.noFlows')} />
      {data.flows.some((flow) => flow.scorecard) ? (
        <p className="-mt-3 text-2xs text-text-muted">{t('departmentPage.scorecardHint')}</p>
      ) : null}

      {data.proposals.length > 0 ? (
        <SectionCard title={t('departmentPage.proposals')} hint={t('departmentPage.proposalsHint')} testId="department-proposals">
          <ul className="divide-y divide-border/50">
            {data.proposals.map((proposal) => (
              <li key={proposal.change_id} className="flex items-center gap-2.5 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-text-primary">{proposal.summary}</span>
                <Badge size="sm">{t(`departmentPage.proposalKind.${proposal.kind}`, { defaultValue: proposal.kind })}</Badge>
                <Link to={inboxPath(null, proposal.signal_id)} className="shrink-0 text-xs text-accent hover:underline">
                  {t('departmentPage.openProposal')}
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <TeamCard data={data} />
        <SectionCard title={t('departmentPage.reach.title')} testId="department-reach">
          <div className="space-y-2">
            <ChipRow
              label={t('departmentPage.reach.flows')}
              items={data.reach.flows.map((f) => ({ id: f.id, name: f.label ? f.label.replace(/^#/, '') : f.name, href: `/flows/${f.id}` }))}
            />
            <ChipRow label={t('departmentPage.reach.channels')} items={data.reach.channels} />
            <ChipRow label={t('departmentPage.reach.connections')} items={data.reach.connections} />
            <ChipRow label={t('departmentPage.reach.organizations')} items={data.reach.organizations} />
          </div>
        </SectionCard>
        <SectionCard title={t('departmentPage.domain.title')} hint={t('departmentPage.domain.hint')}>
          <DomainQuestions questions={data.domain_questions} roomId={data.room_signal_id} onAnswer={onAnswer} />
        </SectionCard>
        <SectionCard title={t('departmentPage.attempts.title')} hint={t('departmentPage.attempts.hint')} testId="department-attempts">
          {!data.reach_attempts || data.reach_attempts.attempts.length === 0 ? (
            <p className="text-sm text-text-secondary">{t('departmentPage.attempts.empty')}</p>
          ) : (
            <>
              <p className="text-xs text-text-secondary">
                {data.reach_attempts.per_person
                  .map((row) => t('departmentPage.attempts.perPerson', { name: row.name, count: row.count }))
                  .join(' · ')}
              </p>
              <ul className="divide-y divide-border/50">
                {data.reach_attempts.attempts.map((a, i) => (
                  <li key={`${a.signal_id}:${a.at}:${i}`} className="flex items-center gap-2.5 py-2 text-sm">
                    {a.channel === 'call' ? (
                      <PhoneCall size={14} className="shrink-0 text-text-muted" aria-hidden />
                    ) : (
                      <Bell size={14} className="shrink-0 text-text-muted" aria-hidden />
                    )}
                    <Link to={inboxPath(null, a.signal_id)} className="min-w-0 flex-1 truncate text-text-primary hover:text-accent">
                      {a.subject || t('departmentPage.attempts.untitled')}
                    </Link>
                    <span className="shrink-0 text-xs text-text-secondary">
                      {a.recipient} · {t(`departmentPage.attempts.status.${a.status}`, { defaultValue: a.status })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>
        {data.outcomes ? (
          <SectionCard title={t('departmentPage.outcomes.title')} hint={t('departmentPage.outcomes.hint')} testId="department-outcomes">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="success">{t('departmentPage.outcomes.accepted', { count: data.outcomes.accepted })}</Badge>
              <Badge>{t('departmentPage.outcomes.rejected', { count: data.outcomes.rejected })}</Badge>
            </div>
            {data.outcomes.per_flow.length ? (
              <ul className="space-y-1 text-xs text-text-secondary">
                {data.outcomes.per_flow.map((row) => (
                  <li key={row.id}>
                    {row.name}: {t('departmentPage.outcomes.feedback', { count: row.feedback })}
                  </li>
                ))}
              </ul>
            ) : null}
          </SectionCard>
        ) : null}
      </div>
    </div>
  )
}

function FolderTab({
  folder,
  canEdit,
}: {
  folder: DepartmentOverview['folders'][number]
  canEdit: boolean
}) {
  const { t } = useTranslation('nav')
  return (
    <div className="space-y-6" data-testid="department-folder">
      <StatGrid className="grid-cols-3 sm:grid-cols-3 lg:grid-cols-3">
        <StatTile label={t('departmentPage.totals.open')} value={folder.totals.open} />
        <StatTile label={t('departmentPage.totals.waiting')} value={folder.totals.waiting} />
        <StatTile
          label={t('departmentPage.totals.overdue')}
          value={<span className={folder.totals.overdue ? 'text-status-warning' : undefined}>{folder.totals.overdue}</span>}
        />
      </StatGrid>
      <Bottlenecks items={folder.bottlenecks} />
      <FlowList flows={folder.flows} empty={t('departmentPage.folderEmpty')} />
      <ProjectFlowBoards projectId={folder.id} canEdit={canEdit} />
      <div className="max-w-md">
        <ProjectAgendaCard projectId={folder.id} />
      </div>
      <WorksInSection projectId={folder.id} canEdit={canEdit} />
      <ProjectDocs projectId={folder.id} canEdit={canEdit} />
    </div>
  )
}

/** One department: who leads it, and its work across all folders or in one folder per tab. */
export default function DepartmentPage() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<DepartmentOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const load = useCallback(async () => {
    if (!token || !id) return
    try {
      setData(await getDepartmentOverview(token, id))
      setError(null)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('departmentPage.loadError')))
    }
  }, [token, id, t])

  useEffect(() => {
    void load()
  }, [load])

  const requested = searchParams.get('folder') ?? ALL
  const tab = data?.folders.some((folder) => folder.id === requested) ? requested : ALL
  const selectTab = (next: string) => {
    const params = new URLSearchParams(searchParams)
    if (next === ALL) params.delete('folder')
    else params.set('folder', next)
    setSearchParams(params, { replace: true })
  }

  const guard = async (run: () => Promise<unknown>) => {
    try {
      await run()
      await load()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('departmentPage.loadError')))
    }
  }

  return (
    <PageContent width="xl" className="space-y-5 py-1">
      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!data && !error ? <CardGridSkeleton cards={3} /> : null}
      {data ? (
        <>
          <PageHeader
            className="mb-0"
            icon={
              <DepartmentIcon
                icon={data.icon}
                canEdit={isAdmin}
                onPick={(icon) => guard(() => (token ? patchTeam(token, data.id, { icon }) : Promise.resolve()))}
              />
            }
            title={data.name}
            subtitle={
              <>
                <p>{data.description || t('departmentPage.subtitle')}</p>
                {data.origin_module || data.autonomy ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                    {data.autonomy ? (
                      <Badge size="sm" data-testid="department-autonomy">
                        {t(`orgCanvas.mode.${data.autonomy}`, { defaultValue: data.autonomy })}
                      </Badge>
                    ) : null}
                    {data.origin_module ? (
                      <Badge size="sm">{t('departmentPage.fromModule', { name: data.origin_module.name })}</Badge>
                    ) : null}
                  </div>
                ) : null}
              </>
            }
            actions={
              data.grid_href ? (
                <Button type="button" size="sm" variant="secondary" asChild>
                  <Link to={data.grid_href} data-testid="open-in-grid">
                    <GRID_ICON size={14} aria-hidden />
                    <span>{t('orgCanvas.openInGrid')}</span>
                  </Link>
                </Button>
              ) : (
                <OpenInGridButton kind="department" id={data.id} />
              )
            }
            primaryAction={
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="px-0 text-text-muted"
                aria-label={t('departmentPage.settings')}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={16} aria-hidden />
              </Button>
            }
          />

          <ParentBand parent={data.parent} />

          <Tabs value={tab} onValueChange={selectTab}>
            <TabsList>
              <TabsTrigger value={ALL}>
                {t('departmentPage.tabAll')}
                <span className="rounded-full bg-bg-elevated px-1.5 text-2xs tabular-nums text-text-muted">
                  {data.totals.open + data.totals.waiting}
                </span>
              </TabsTrigger>
              {data.folders.map((folder) => (
                <TabsTrigger key={folder.id} value={folder.id}>
                  <FolderOpen size={14} className="shrink-0 opacity-70" aria-hidden />
                  {folder.name}
                  {folder.open ? (
                    <span className="rounded-full bg-bg-elevated px-1.5 text-2xs tabular-nums text-text-muted">{folder.open}</span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={ALL} className="pt-2">
              <AllTab
                data={data}
                onAnswer={(key, answer) =>
                  guard(() => (token ? answerDomainQuestion(token, data.id, key, answer) : Promise.resolve()))
                }
              />
            </TabsContent>
            {data.folders.map((folder) => (
              <TabsContent key={folder.id} value={folder.id} className="pt-2">
                <FolderTab folder={folder} canEdit={isAdmin} />
              </TabsContent>
            ))}
          </Tabs>

          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogContent className="max-h-[min(880px,92vh)] w-[calc(100%-2rem)] max-w-xl gap-0 overflow-hidden p-0">
              <DialogHeader className="border-b border-border px-5 py-4 pr-14 text-left">
                <DialogTitle>{t('departmentPage.awareness.title')}</DialogTitle>
                <DialogDescription>{t('departmentPage.awareness.hint')}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[min(760px,calc(92vh-5.5rem))] overflow-y-auto px-5 py-4" data-testid="department-awareness">
                {data.awareness ? (
                  <AwarenessEditor
                    awareness={data.awareness}
                    canEdit={isAdmin}
                    onSave={(patch) =>
                      guard(() => (token ? patchDepartmentAwareness(token, data.id, patch) : Promise.resolve()))
                    }
                  />
                ) : (
                  <p className="text-sm text-text-secondary">{t('departmentPage.awareness.noLead')}</p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </PageContent>
  )
}
