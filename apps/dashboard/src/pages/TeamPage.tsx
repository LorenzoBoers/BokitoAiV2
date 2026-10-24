import { departmentPath, GRID_PATH, ORGANIZATION_PATH } from '../lib/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import { MarketplaceHireHint } from '../components/layout/MarketplaceHireHint'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { Card } from '../components/ui/card'
import { EntityList, EntityRow } from '../components/ui/entity-row'
import { IconTile } from '../components/ui/icon-tile'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { PageHeader } from '../components/ui/page-header'
import { useConfirm } from '../components/ui/confirm-dialog'
import { Input } from '../components/ui/input'
import { AvatarStack } from '../components/ui/AvatarStack'
import { ChoiceSelect, type ChoiceGroup } from '../components/ui/ChoiceSelect'
import { resolveTeamStackMembers } from '../lib/team-facepile'
import { platformIcon } from '../lib/platform-icons'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import MemberManagement, { type MemberMeta } from './MemberManagement'
import {
  createTeam,
  deleteTeam,
  formatAnswerMinutes,
  getTeamOverview,
  patchTeam,
  PICKUP_MODES,
  placeAgent,
  type Team,
  type TeamOverview,
  type TeamPickup,
} from '../lib/teams-api'
import { useAgentLive } from '../hooks/useAgentPresence'

function resolveTeamMembers(team: Team, overview: TeamOverview) {
  return resolveTeamStackMembers(team.members, {
    people: overview.people,
    agents: overview.agents,
  })
}

function scrollToId(id: string) {
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

export default function TeamPage() {
  const { t } = useTranslation('nav')
  useAgentLive()
  const { token, hasPermission } = useAuth()
  const canManage = hasPermission('invite_members')
  const [params, setParams] = useSearchParams()
  const { hash } = useLocation()
  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [teamsLoading, setTeamsLoading] = useState(true)
  const [creating, setCreating] = useState(() => params.get('new') === '1')
  const newParent = params.get('parent')
  const showDepartments = params.get('tab') === 'departments'

  const reload = useCallback(async () => {
    if (!token) return
    setTeamsLoading(true)
    try {
      setOverview(await getTeamOverview(token))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('teamPage.loadError'))
    } finally {
      setTeamsLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Legacy ?tab=… and #hash deep links land on the matching section.
  useEffect(() => {
    const tab = params.get('tab')
    if (tab === 'teams') {
      setParams({ tab: 'departments' }, { replace: true })
      return
    }
    if (tab === 'agents' || tab === 'people') {
      setParams({}, { replace: true })
      scrollToId('directory')
      return
    }
    const target = hash.replace(/^#/, '')
    if (target === 'teams') {
      setParams({ tab: 'departments' }, { replace: true })
      return
    }
    if (target === 'directory' || target === 'member-invite') {
      scrollToId(target)
    }
  }, [hash, params, setParams])

  const teamNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const team of overview?.teams ?? []) map[team.id] = team.name
    return map
  }, [overview, t])

  const metaByUuid = useMemo(() => {
    const map: Record<string, MemberMeta> = {}
    for (const p of overview?.people ?? []) {
      map[p.uuid] = {
        presence: p.presence.status,
        teams: p.team_ids.filter((id) => !overview?.teams.find((tm) => tm.id === id)?.system).map((id) => teamNames[id]),
        openOwned: p.open_owned,
        openTurn: p.open_turn,
        lastSeenAt: p.presence.last_seen_at,
      }
    }
    return map
  }, [overview, teamNames])

  const unplaced = useMemo(() => (overview?.agents ?? []).filter((agent) => agent.unplaced), [overview])
  const departmentChoices: ChoiceGroup[] = useMemo(
    () => [
      {
        items: (overview?.teams ?? [])
          .filter((team) => !team.system && !team.root)
          .map((team) => ({ value: team.id, label: team.name, kind: 'icon' as const, icon: platformIcon(team.icon) ?? Building2 })),
      },
    ],
    [overview],
  )

  const place = async (agentId: string, agentName: string, departmentId: string) => {
    if (!token) return
    try {
      await placeAgent(token, departmentId, agentId)
      toast.success(t('teamPage.placed', { name: agentName, department: teamNames[departmentId] ?? '' }))
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('teamPage.saveError'))
    }
  }

  const directoryTeamNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const team of overview?.teams ?? []) {
      if (team.system) continue
      map[team.id] = teamNames[team.id]
    }
    return map
  }, [overview, teamNames])

  return (
    <PageContent width="xl" className="space-y-6">
      {showDepartments ? (
        <PageHeader
          className="mb-0"
          title={t('teamPage.sections.teams')}
          subtitle={t('teamPage.sections.teamsHint')}
          primaryAction={
            canManage ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} />
                {t('teamPage.newTeam')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <PageHeader className="mb-0" title={t('teamPage.sections.people')} />
      )}
      {showDepartments ? null : (
        <MemberManagement
          metaByUuid={metaByUuid}
          agents={overview?.agents ?? []}
          teamNames={directoryTeamNames}
          onChanged={() => void reload()}
        />
      )}

      {showDepartments ? (
      <section id="teams" className="space-y-3 scroll-mt-24">
        <Card className="overflow-hidden">
          <EntityList className="px-1 py-1" loading={teamsLoading && !overview}>
            {(overview?.teams ?? []).map((team) => {
              const stack = overview ? resolveTeamMembers(team, overview) : []
              const Icon = platformIcon(team.icon) ?? Building2
              const canOpen = !team.system && !team.root
              const about = team.system
                ? t('teamPage.systemHint.all')
                : team.description || t('teamPage.noDescription' /* design-system-ignore: waarde, label of keuze, geen lege lijst */)
              return (
                <EntityRow
                  key={team.id}
                  href={canOpen ? departmentPath(team.id) : ORGANIZATION_PATH}
                  data-testid={canOpen ? 'open-department' : 'open-organization'}
                  leading={
                    <IconTile icon={Icon} tone="accent" />
                  }
                  title={team.system ? t('teamPage.orgRow') : teamNames[team.id]}
                  badges={team.system ? <Badge variant="neutral">{t('teamPage.systemBadge')}</Badge> : null}
                  description={[
                    team.contact ? t('departmentPage.children.contact', { name: team.contact.name }) : null,
                    team.system ? null : t(`teamPage.pickup.${team.pickup}`),
                    about,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={
                    <span data-testid="team-metrics">
                      {t('teamPage.metrics', {
                        questions: team.metrics.questions,
                        answerTime: formatAnswerMinutes(team.metrics.answer_minutes),
                        pickedUp: team.metrics.picked_up,
                      })}
                      {stack.length === 0 ? ` · ${t('teamPage.memberCount', { count: team.member_count })}` : null}
                    </span>
                  }
                  trailing={
                    stack.length > 0 ? <AvatarStack members={stack} size={32} linkAgents={false} /> : null
                  }
                />
              )
            })}
          </EntityList>
        </Card>
        {unplaced.length > 0 && overview ? (
          <Card className="space-y-2 p-4" data-testid="unplaced-agents">
            <div>
              <p className="text-sm font-medium text-text-heading">{t('teamPage.unplacedTitle')}</p>
              <p className="text-xs text-text-muted">{t('teamPage.unplaced', { count: unplaced.length })}</p>
            </div>
            <ul className="divide-y divide-border/50">
              {unplaced.map((agent) => (
                <li key={agent.id} className="flex items-center gap-3 py-2">
                  <Link to={`/agents/${agent.id}`} className="min-w-0 flex-1 truncate text-sm text-text-heading hover:underline">
                    {agent.name}
                  </Link>
                  {canManage ? (
                    <ChoiceSelect
                      triggerClassName="w-56"
                      groups={departmentChoices}
                      value=""
                      placeholder={t('teamPage.place')}
                      aria-label={t('teamPage.placeLabel', { name: agent.name })}
                      onValueChange={(departmentId) => void place(agent.id, agent.name, departmentId)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </section>
      ) : null}

      {overview && creating ? (
        <TeamDialog
          team={null}
          overview={overview}
          initialParent={newParent}
          onClose={() => {
            setCreating(false)
            if (params.get('new')) setParams({ tab: 'departments' }, { replace: true })
          }}
          onSaved={() => {
            setCreating(false)
            void reload()
          }}
        />
      ) : null}

      <MarketplaceHireHint />
      <PageRelatedLinks
        links={[
          { to: GRID_PATH, label: t('orgCanvas.link') },
          { to: '/agents', label: t('teamPage.relatedAgents') },
          { to: '/settings/setup', label: t('membersPage.openSetup') },
        ]}
      />
    </PageContent>
  )
}

const ORG_PARENT = 'org'

function TeamDialog({
  team,
  overview,
  initialParent = null,
  onClose,
  onSaved,
}: {
  team: Team | null
  overview: TeamOverview
  initialParent?: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [pickup, setPickup] = useState<TeamPickup>(team?.pickup ?? 'people')
  const rootId = overview.teams.find((row) => row.system || row.root)?.id ?? null
  const [parent, setParent] = useState<string>(() => {
    const start = team ? team.parent_id : initialParent
    const takesChild = overview.teams.some((row) => row.id === start && row.parent_id === rootId)
    return start && start !== rootId && takesChild ? start : ORG_PARENT
  })
  const [busy, setBusy] = useState(false)
  const isSystem = team?.system ?? false
  // Departments go at most two levels deep, so only top-level departments can take a child.
  const parentGroups: ChoiceGroup[] = [
    {
      items: [
        { value: ORG_PARENT, label: t('teamPage.parentOrg'), kind: 'icon', icon: Building2 },
        ...overview.teams
          .filter((row) => !row.system && !row.root && row.parent_id === rootId && row.id !== team?.id)
          .map((row) => ({ value: row.id, label: row.name, kind: 'icon' as const, icon: platformIcon(row.icon) ?? Building2 })),
      ],
    },
  ]

  const save = async () => {
    if (!token) return
    setBusy(true)
    try {
      const parent_id = parent === ORG_PARENT ? null : parent
      if (!team) {
        const created = await createTeam(token, { name, description, pickup, parent_id })
        onSaved()
        navigate(departmentPath(created.id))
        return
      }
      if (isSystem) return
      await patchTeam(token, team.id, { name, description, pickup, parent_id })
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('teamPage.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!token || !team || isSystem) return
    if (!(await confirm({ description: t('teamPage.deleteConfirm', { name: team.name }), destructive: true }))) return
    setBusy(true)
    try {
      await deleteTeam(token, team.id)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('teamPage.saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{team ? t('teamPage.editTitle') : t('teamPage.newTeam')}</DialogTitle>
          <DialogDescription>{t('teamPage.dialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!isSystem ? (
            <>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('teamPage.namePlaceholder')} />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('teamPage.descriptionPlaceholder')}
              />
            </>
          ) : null}
          <div className="space-y-1">
            <p className="text-xs font-medium text-text-heading">{t('teamPage.pickupLabel')}</p>
            <Select value={pickup} onValueChange={(v) => setPickup(v as TeamPickup)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PICKUP_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`teamPage.pickup.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">{t(`teamPage.pickupHint.${pickup}`)}</p>
          </div>
          {!isSystem ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-text-heading">{t('teamPage.parentLabel')}</p>
              <ChoiceSelect
                groups={parentGroups}
                value={parent}
                onValueChange={setParent}
                aria-label={t('teamPage.parentLabel')}
              />
              <p className="text-xs text-text-muted">{t('teamPage.parentHint')}</p>
            </div>
          ) : null}
          {!team ? <p className="text-xs text-text-muted">{t('teamPage.crewAfterCreate')}</p> : null}
        </div>
        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          {team && !isSystem ? (
            <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy} className="text-status-error">
              <Trash2 size={14} />
              {t('teamPage.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('teamPage.cancel')}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy || (!isSystem && !name.trim())}>
              {t('teamPage.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
