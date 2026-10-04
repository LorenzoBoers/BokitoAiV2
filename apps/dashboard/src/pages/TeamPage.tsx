import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import { AiAvatar } from '../components/ui/AiAvatar'
import { TeamAvatar } from '../components/ui/TeamAvatar'
import { UserAvatar } from '../components/ui/UserAvatar'
import {
  TEAM_AVATAR_ICON_KEYS,
  resolveTeamAvatarIcon,
  toTeamAvatarProps,
} from '../lib/team-avatar'
import type { TeamAvatarKind } from '../lib/teams-api'
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
  type PresenceStatus,
  type Team,
  type TeamMemberRef,
  type TeamOverview,
  type TeamPickup,
} from '../lib/teams-api'
import { cn } from '../lib/utils'

const AVATAR_STACK_MAX = 5

function memberKey(ref: TeamMemberRef): string {
  return `${ref.kind}:${ref.id}`
}

type StackMember =
  | { key: string; kind: 'user'; name: string; email: string; avatarUrl: string | null; presence?: PresenceStatus }
  | { key: string; kind: 'agent'; name: string; id: string; activity?: 'standby' | 'working' | 'error' }

function resolveTeamMembers(team: Team, overview: TeamOverview): StackMember[] {
  const peopleById = new Map(overview.people.map((p) => [p.uuid, p]))
  const agentsById = new Map(overview.agents.map((a) => [a.id, a]))
  const out: StackMember[] = []
  for (const ref of team.members) {
    if (ref.kind === 'user') {
      const person = peopleById.get(ref.id)
      if (!person) continue
      out.push({
        key: memberKey(ref),
        kind: 'user',
        name: person.name,
        email: person.email,
        avatarUrl: person.avatar_url,
        presence: person.presence.status,
      })
    } else {
      const agent = agentsById.get(ref.id)
      if (!agent) continue
      const status = String(agent.status || 'standby').toLowerCase()
      const activity =
        status === 'working' || status === 'active'
          ? ('working' as const)
          : status === 'error'
            ? ('error' as const)
            : ('standby' as const)
      out.push({ key: memberKey(ref), kind: 'agent', name: agent.name, id: agent.id, activity })
    }
  }
  return out
}

/** Overlapping facepile for team members (people + agents). */
function TeamMemberStack({ members, className }: { members: StackMember[]; className?: string }) {
  if (members.length === 0) return null
  const shown = members.slice(0, AVATAR_STACK_MAX)
  const overflow = members.length - shown.length
  const size = 28
  return (
    <span className={cn('flex items-center', className)} aria-hidden>
      {shown.map((member, index) => (
        <span
          key={member.key}
          className={cn(
            'relative inline-flex rounded-full ring-2 ring-bg-surface',
            index > 0 && '-ml-2',
          )}
          style={{ zIndex: shown.length - index }}
          title={member.name}
        >
          {member.kind === 'user' ? (
            <UserAvatar
              name={member.name}
              email={member.email}
              avatarUrl={member.avatarUrl}
              size={size}
              presence={member.presence}
              decorative
            />
          ) : (
            <AiAvatar
              name={member.name}
              seed={member.id}
              size={size}
              activity={member.activity ?? 'standby'}
            />
          )}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="-ml-2 flex items-center justify-center rounded-full bg-bg-elevated text-2xs font-medium tabular-nums text-text-muted ring-2 ring-bg-surface"
          style={{ width: size, height: size, zIndex: 0 }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  )
}

function scrollToId(id: string) {
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

export default function TeamPage() {
  const { t } = useTranslation('nav')
  const { token, hasPermission } = useAuth()
  const canManage = hasPermission('invite_members')
  const [params, setParams] = useSearchParams()
  const { hash } = useLocation()
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

  // Legacy ?tab=… and #hash deep links land on the matching section.
  useEffect(() => {
    const tab = params.get('tab')
    if (tab === 'teams') {
      setParams({}, { replace: true })
      scrollToId('teams')
      return
    }
    if (tab === 'agents' || tab === 'people') {
      setParams({}, { replace: true })
      scrollToId('directory')
      return
    }
    const target = hash.replace(/^#/, '')
    if (target === 'teams' || target === 'directory' || target === 'member-invite') {
      scrollToId(target)
    }
  }, [hash, params, setParams])

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
      <ContentHeader
        guide="team"
        title={t('tabs.team.title')}
        subtitle={t('tabs.team.subtitle')}
      />

      <MemberManagement
        metaByUuid={metaByUuid}
        agents={overview?.agents ?? []}
        teamNames={directoryTeamNames}
      />

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
          {(overview?.teams ?? []).map((team) => {
            const stack = overview ? resolveTeamMembers(team, overview) : []
            return (
              <Card key={team.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <TeamAvatar
                      {...toTeamAvatarProps(team)}
                      size={28}
                      decorative
                      presence={team.presence?.status}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-heading">
                        <span className="truncate-fade">{teamNames[team.id]}</span>
                        {team.system ? <Badge variant="secondary">{t('teamPage.systemBadge')}</Badge> : null}
                        {team.pinned ? <Badge variant="neutral">{t('teamPage.pinnedBadge')}</Badge> : null}
                      </p>
                      <p className="truncate-fade text-xs text-text-muted">
                        {team.system
                          ? t(`teamPage.systemHint.${team.kind}`)
                          : team.description || t('teamPage.noDescription')}
                      </p>
                      <p className="text-xs text-text-secondary">
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
                      </p>
                    </div>
                  </div>
                  {canManage && !team.system ? (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setEditing(team)}>
                      {t('teamPage.edit')}
                    </Button>
                  ) : null}
                  <TeamMemberStack members={stack} className="shrink-0" />
                  {stack.length === 0 ? (
                    <span className="shrink-0 text-xs text-text-muted">
                      {t('teamPage.memberCount', { count: team.member_count })}
                    </span>
                  ) : null}
                </div>
              </Card>
            )
          })}
        </div>
      </section>

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
  const [avatarKind, setAvatarKind] = useState<TeamAvatarKind>(
    () => (team?.avatar_kind === 'icon' || team?.avatar_kind === 'image' ? team.avatar_kind : 'initials'),
  )
  const [avatarIcon, setAvatarIcon] = useState(team?.avatar_icon ?? 'users')
  const [avatarColor] = useState(team?.avatar_color ?? null)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((team?.members ?? []).map(memberKey)),
  )
  const [busy, setBusy] = useState(false)
  const isSystem = team?.system ?? false
  const previewName = name.trim() || team?.name || t('teamPage.namePlaceholder')
  const avatarPayload = {
    avatar_kind: avatarKind === 'image' ? 'initials' : avatarKind,
    avatar_icon: avatarKind === 'icon' ? avatarIcon : null,
    avatar_color: avatarColor,
    avatar_image_url: null as string | null,
  }

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
          pinned,
          members: members(),
          ...avatarPayload,
          avatar_kind: avatarPayload.avatar_kind as TeamAvatarKind,
        })
      } else {
        if (isSystem) return
        await patchTeam(token, team.id, {
          name,
          description,
          pickup,
          pinned,
          ...avatarPayload,
          avatar_kind: avatarPayload.avatar_kind as TeamAvatarKind,
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
          <div className="space-y-2 rounded-lg border border-border/60 px-3 py-2">
            <div className="flex items-center gap-3">
              <TeamAvatar
                {...toTeamAvatarProps({
                  id: team?.id,
                  name: previewName,
                  avatar_kind: avatarPayload.avatar_kind,
                  avatar_icon: avatarPayload.avatar_icon,
                  avatar_color: avatarPayload.avatar_color,
                })}
                size={36}
                decorative
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-text-heading">{t('teamPage.avatarLabel')}</p>
                <p className="text-xs text-text-muted">{t('teamPage.avatarHint')}</p>
              </div>
              <Select
                value={avatarKind === 'icon' ? 'icon' : 'initials'}
                onValueChange={(v) => setAvatarKind(v === 'icon' ? 'icon' : 'initials')}
              >
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="initials">{t('teamPage.avatarInitials')}</SelectItem>
                  <SelectItem value="icon">{t('teamPage.avatarIcon')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {avatarKind === 'icon' ? (
              <div className="flex flex-wrap gap-1.5">
                {TEAM_AVATAR_ICON_KEYS.slice(0, 12).map((key) => {
                  const Icon = resolveTeamAvatarIcon(key)
                  if (!Icon) return null
                  const active = avatarIcon === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAvatarIcon(key)}
                      className={cn(
                        'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                        active
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border/60 text-text-muted hover:bg-bg-hover',
                      )}
                      title={key}
                    >
                      <Icon size={14} />
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
          {!isSystem ? (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
              {overview.people.map((p) => {
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
              {overview.agents.map((a) => {
                const ref: TeamMemberRef = { kind: 'agent', id: a.id }
                return (
                  <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-hover/60">
                    <input type="checkbox" checked={selected.has(memberKey(ref))} onChange={() => toggle(ref)} />
                    <AiAvatar
                      name={a.name}
                      seed={a.id}
                      size={20}
                      activity={
                        String(a.status || '').toLowerCase() === 'working' ||
                        String(a.status || '').toLowerCase() === 'active'
                          ? 'working'
                          : String(a.status || '').toLowerCase() === 'error'
                            ? 'error'
                            : 'standby'
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
