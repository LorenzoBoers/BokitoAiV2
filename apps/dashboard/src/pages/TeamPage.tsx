import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import { AiAvatar } from '../components/ui/AiAvatar'
import { UserAvatar } from '../components/ui/UserAvatar'
import { PresenceDot } from '../components/ui/PresenceDot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
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
  setMyAway,
  setTeamMembers,
  type Team,
  type TeamMemberRef,
  type TeamOverview,
  type TeamPickup,
} from '../lib/teams-api'

type TabId = 'people' | 'agents' | 'teams'

function memberKey(ref: TeamMemberRef): string {
  return `${ref.kind}:${ref.id}`
}

export default function TeamPage() {
  const { t } = useTranslation('nav')
  const { token, user, hasPermission } = useAuth()
  const canManage = hasPermission('invite_members')
  const [params, setParams] = useSearchParams()
  const tab = (['people', 'agents', 'teams'].includes(params.get('tab') ?? '') ? params.get('tab') : 'people') as TabId
  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [editing, setEditing] = useState<Team | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    if (!token) return
    try {
      setOverview(await getTeamOverview(token))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('teamPage.loadError'))
    }
  }, [token, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const teamNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const team of overview?.teams ?? []) map[team.id] = team.system ? t(`teamPage.system.${team.kind}`) : team.name
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
      }
    }
    return map
  }, [overview, teamNames])

  const me = overview?.people.find((p) => p.email === user?.email)
  const toggleAway = async (away: boolean) => {
    if (!token) return
    try {
      await setMyAway(token, away)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('teamPage.saveError'))
    }
  }

  return (
    <PageContent width="xl" className="space-y-4">
      <ContentHeader
        guide="team"
        title={t('tabs.team.title')}
        subtitle={t('tabs.team.subtitle')}
        meta={
          me ? (
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <PresenceDot status={me.presence.status} withLabel />
              <Switch checked={me.presence.status === 'away'} onCheckedChange={(v) => void toggleAway(v)} />
              {t('teamPage.away')}
            </label>
          ) : null
        }
      />
      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="people">
            {t('teamPage.tabs.people')}
            <span className="text-xs text-text-muted">{overview?.people.length ?? ''}</span>
          </TabsTrigger>
          <TabsTrigger value="agents">
            {t('teamPage.tabs.agents')}
            <span className="text-xs text-text-muted">{overview?.agents.length ?? ''}</span>
          </TabsTrigger>
          <TabsTrigger value="teams">
            {t('teamPage.tabs.teams')}
            <span className="text-xs text-text-muted">{overview?.teams.length ?? ''}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="people">
          <MemberManagement metaByUuid={metaByUuid} />
        </TabsContent>

        <TabsContent value="agents">
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('teamPage.cols.agent')}</TableHead>
                  <TableHead>{t('teamPage.cols.teams')}</TableHead>
                  <TableHead>{t('teamPage.cols.open')}</TableHead>
                  <TableHead>{t('teamPage.cols.ceiling')}</TableHead>
                  <TableHead>{t('teamPage.cols.questions')}</TableHead>
                  <TableHead>{t('teamPage.cols.unchanged')}</TableHead>
                  <TableHead>{t('teamPage.cols.answerTime')}</TableHead>
                  <TableHead>{t('teamPage.cols.pickedUp')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(overview?.agents ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-text-muted">
                      {t('teamPage.noAgents')}
                    </TableCell>
                  </TableRow>
                ) : (
                  overview?.agents.map((agent) => (
                    <TableRow key={agent.id}>
                      <TableCell>
                        <Link to={`/agents/${agent.id}`} className="flex items-center gap-2 hover:underline">
                          <AiAvatar name={agent.name} seed={agent.id} size={26} />
                          <span>{agent.name}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {agent.team_ids
                          .filter((id) => !overview.teams.find((tm) => tm.id === id)?.system)
                          .map((id) => teamNames[id])
                          .join(', ') || '-'}
                      </TableCell>
                      <TableCell>{agent.open_owned}</TableCell>
                      <TableCell>
                        <Badge variant="neutral">
                          {t(`teamPage.ceiling.${agent.autonomy_level}`, { defaultValue: agent.autonomy_level })}
                        </Badge>
                      </TableCell>
                      <TableCell>{agent.metrics.questions}</TableCell>
                      <TableCell className="text-text-secondary">
                        {agent.metrics.unchanged_rate == null
                          ? '-'
                          : `${Math.round(agent.metrics.unchanged_rate * 100)}%`}
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {formatAnswerMinutes(agent.metrics.answer_minutes)}
                      </TableCell>
                      <TableCell>{agent.metrics.picked_up}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="teams" className="space-y-3">
          {canManage ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} />
                {t('teamPage.newTeam')}
              </Button>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {(overview?.teams ?? []).map((team) => (
              <Card key={team.id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-text-heading">
                      <UsersRound size={14} className="text-text-muted" />
                      {teamNames[team.id]}
                      {team.system ? <Badge variant="secondary">{t('teamPage.systemBadge')}</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {team.system ? t(`teamPage.systemHint.${team.kind}`) : team.description || t('teamPage.noDescription')}
                    </p>
                  </div>
                  {canManage ? (
                    <Button size="sm" variant="outline" onClick={() => setEditing(team)}>
                      {t('teamPage.edit')}
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-text-secondary">
                  {t('teamPage.memberCount', { count: team.member_count })} ·{' '}
                  {t(`teamPage.pickup.${team.pickup}`)}
                  {team.pinned ? ` · ${t('teamPage.pinnedBadge')}` : ''}
                </p>
                <p className="text-xs text-text-muted" data-testid="team-metrics">
                  {t('teamPage.metrics', {
                    questions: team.metrics.questions,
                    answerTime: formatAnswerMinutes(team.metrics.answer_minutes),
                    pickedUp: team.metrics.picked_up,
                  })}
                </p>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

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
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [pickup, setPickup] = useState<TeamPickup>(team?.pickup ?? 'people')
  const [pinned, setPinned] = useState(team?.pinned ?? false)
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
        await createTeam(token, { name, description, pickup, pinned, members: members() })
      } else if (isSystem) {
        await patchTeam(token, team.id, { pickup, pinned })
      } else {
        await patchTeam(token, team.id, { name, description, pickup, pinned })
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
    if (!window.confirm(t('teamPage.deleteConfirm', { name: team.name }))) return
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
          <label className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
            <span className="min-w-0">
              <span className="block text-xs font-medium text-text-heading">{t('teamPage.pinLabel')}</span>
              <span className="block text-xs text-text-muted">{t('teamPage.pinHint')}</span>
            </span>
            <Switch checked={pinned} onCheckedChange={setPinned} />
          </label>
          {!isSystem ? (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
              {overview.people.map((p) => {
                const ref: TeamMemberRef = { kind: 'user', id: p.uuid }
                return (
                  <label key={p.uuid} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-hover/60">
                    <input type="checkbox" checked={selected.has(memberKey(ref))} onChange={() => toggle(ref)} />
                    

                    <span className="text-sm">{p.name}</span>
                    <PresenceDot status={p.presence.status} />
                  </label>
                )
              })}
              {overview.agents.map((a) => {
                const ref: TeamMemberRef = { kind: 'agent', id: a.id }
                return (
                  <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-hover/60">
                    <input type="checkbox" checked={selected.has(memberKey(ref))} onChange={() => toggle(ref)} />
                    <AiAvatar name={a.name} seed={a.id} size={20} />
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
