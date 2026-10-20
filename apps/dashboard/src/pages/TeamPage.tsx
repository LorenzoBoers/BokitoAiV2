import { GRID_PATH } from '../lib/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { asAgentStatus } from '../lib/presence'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { ENTITY_ICONS } from '../lib/entity-icons'
import { openEntityPath } from '../lib/open-entity'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import { PageRelatedLinks } from '../components/layout/PageRelatedLinks'
import { OpenInGridButton } from '../components/org/OpenInGridButton'
import ContentHeader from '../components/shell/ContentHeader'
import { WorkforceSectionTabs } from '../components/shell/SectionTabs'
import { TeamCardsSkeleton } from '../components/ui/skeleton'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { useConfirm } from '../components/ui/confirm-dialog'
import { Input } from '../components/ui/input'
import { AgentMark } from '../components/ui/AgentMark'
import { AvatarStack } from '../components/ui/AvatarStack'
import { TeamFacepile } from '../components/ui/TeamFacepile'
import { UserAvatar } from '../components/ui/UserAvatar'
import { resolveTeamStackMembers } from '../lib/team-facepile'
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
  setTeamMembers,
  type Team,
  type TeamMemberRef,
  type TeamOverview,
  type TeamPickup,
} from '../lib/teams-api'
import { useAgentLive, agentPresenceOf } from '../hooks/useAgentPresence'

const ConversationIcon = ENTITY_ICONS.conversation

function memberKey(ref: TeamMemberRef): string {
  return `${ref.kind}:${ref.id}`
}

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
  const [editing, setEditing] = useState<Team | null>(null)
  const [creating, setCreating] = useState(false)
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
      <WorkforceSectionTabs />
      <ContentHeader
        guide="team"
        title={t('tabs.team.title')}
        subtitle={t('tabs.team.subtitle')}
        meta={<OpenInGridButton />}
      />

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
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-text-heading">{t('teamPage.sections.teams')}</h2>
            <p className="text-xs text-text-muted">{t('teamPage.sections.teamsHint')}</p>
          </div>
          {canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} />
              {t('teamPage.newTeam')}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          {teamsLoading && !overview ? <TeamCardsSkeleton /> : null}
          {(overview?.teams ?? []).map((team) => {
            const stack = overview ? resolveTeamMembers(team, overview) : []
            return (
              <Card key={team.id} className="px-4 py-3">
                {/* Fixed facepile column so names line up regardless of avatar count. */}
                <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[5.75rem_minmax(0,1fr)_auto]">
                  <div className="flex h-8 w-[5.75rem] shrink-0 items-center justify-center">
                    {stack.length > 0 ? (
                      <AvatarStack members={stack} size={32} linkAgents={false} />
                    ) : (
                      <TeamFacepile
                        team={team}
                        size={32}
                        linkAgents={false}
                        presence={team.presence?.status}
                      />
                    )}
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-text-heading">
                      {team.system ? (
                        <span className="truncate-fade">{teamNames[team.id]}</span>
                      ) : (
                        <Link
                          to={openEntityPath({ type: 'team', id: team.id })}
                          className="truncate-fade hover:text-accent hover:underline"
                          title={t('teamPage.openFolder', { name: teamNames[team.id] })}
                          data-testid="team-folder-link"
                        >
                          {teamNames[team.id]}
                        </Link>
                      )}
                      {team.system ? <Badge variant="secondary">{t('teamPage.systemBadge')}</Badge> : null}
                    </p>
                    <p className="truncate-fade text-xs text-text-muted">
                      {team.system
                        ? t('teamPage.systemHint.all')
                        : team.description || t('teamPage.noDescription')}
                    </p>
                    <p className="truncate-fade text-xs text-text-secondary">
                      {team.system ? null : (
                        <>
                          {t(`teamPage.pickup.${team.pickup}`)}
                          <span className="text-text-muted">{' · '}</span>
                        </>
                      )}
                      <span className="text-text-muted" data-testid="team-metrics">
                        {t('teamPage.metrics', {
                          questions: team.metrics.questions,
                          answerTime: formatAnswerMinutes(team.metrics.answer_minutes),
                          pickedUp: team.metrics.picked_up,
                        })}
                      </span>
                      {stack.length === 0 ? (
                        <>
                          <span className="text-text-muted">{' · '}</span>
                          {t('teamPage.memberCount', { count: team.member_count })}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {team.system ? null : (
                      <Button size="sm" variant="ghost" className="shrink-0" asChild>
                        <Link to={openEntityPath({ type: 'team', id: team.id })}>
                          <ConversationIcon size={13} aria-hidden />
                          {t('teamPage.openConversations')}
                        </Link>
                      </Button>
                    )}
                    {canManage && !team.system ? (
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => setEditing(team)}>
                        {t('teamPage.edit')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </section>
      ) : null}

      {overview && (editing || creating) ? (
        <TeamDialog
          team={editing}
          overview={overview}
          onClose={() => {
            setEditing(null)
            setCreating(false)
          }}
          onSaved={() => {
            setEditing(null)
            setCreating(false)
            void reload()
          }}
        />
      ) : null}

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

function TeamDialog({
  team,
  overview,
  onClose,
  onSaved,
}: {
  team: Team | null
  overview: TeamOverview
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const confirm = useConfirm()
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [pickup, setPickup] = useState<TeamPickup>(team?.pickup ?? 'people')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((team?.members ?? []).map(memberKey)),
  )
  const [busy, setBusy] = useState(false)
  const isSystem = team?.system ?? false

  const toggle = (ref: TeamMemberRef) =>
    setSelected((prev) => {
      const next = new Set(prev)
      const key = memberKey(ref)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const members = (): TeamMemberRef[] =>
    [...selected].map((key) => {
      const [kind, id] = key.split(':')
      return { kind: kind as 'user' | 'agent', id }
    })

  const save = async () => {
    if (!token) return
    setBusy(true)
    try {
      if (!team) {
        await createTeam(token, {
          name,
          description,
          pickup,
          members: members(),
        })
      } else {
        if (isSystem) return
        await patchTeam(token, team.id, {
          name,
          description,
          pickup,
        })
        await setTeamMembers(token, team.id, members())
      }
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
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
              {overview.people.filter((p) => !p.deactivated).map((p) => {
                const ref: TeamMemberRef = { kind: 'user', id: p.uuid }
                return (
                  <label key={p.uuid} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-hover/60">
                    <input type="checkbox" checked={selected.has(memberKey(ref))} onChange={() => toggle(ref)} />
                    <UserAvatar
                      name={p.name}
                      email={p.email}
                      avatarUrl={p.avatar_url}
                      size={20}
                      presence={p.presence.status}
                      decorative
                    />
                    <span className="text-sm">{p.name}</span>
                  </label>
                )
              })}
              {overview.agents.filter((a) => !a.deactivated).map((a) => {
                const ref: TeamMemberRef = { kind: 'agent', id: a.id }
                return (
                  <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-hover/60">
                    <input type="checkbox" checked={selected.has(memberKey(ref))} onChange={() => toggle(ref)} />
                    <AgentMark
                      agent={a}
                      size={20}
                      decorative={false}
                      mode="static"
                      activity={
                        agentPresenceOf(a.id) !== 'standby'
                          ? agentPresenceOf(a.id)
                          : asAgentStatus(a.status)
                      }
                    />
                    <span className="text-sm">{a.name}</span>
                  </label>
                )
              })}
            </div>
          ) : null}
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
            <Button variant="outline" size="sm" onClick={onClose}>
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
