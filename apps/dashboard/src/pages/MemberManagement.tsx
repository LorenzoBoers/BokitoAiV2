import { useEffect, useMemo, useState } from 'react'
import { MailPlus, Plus, Search, Trash2, Users, X } from 'lucide-react'
import { UserAvatar } from '../components/ui/UserAvatar'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { appRoutes } from '../api/routes/app.routes'
import { apiGet, apiPost } from '../lib/api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { PageContent } from '../components/layout/PageContent'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'

type MemberRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'member'

type Member = {
  id: string
  name: string
  email: string
  role: MemberRole
  isCurrentUser: boolean
}

type Invite = {
  id: string
  email: string
  role: MemberRole
  invitedBy: string
  invitedAt: string | null
}

type Team = {
  id: string
  name: string
  description: string
  memberIds: string[]
}

const ROLE_OPTIONS: Array<{ value: MemberRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
]

function asRole(value: unknown): MemberRole {
  const normalized = typeof value === 'string' ? value.toLowerCase() : ''
  if (normalized === 'owner' || normalized === 'admin' || normalized === 'editor' || normalized === 'viewer' || normalized === 'member') {
    return normalized
  }
  return 'viewer'
}

function toDateLabel(value: string | null): string {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unknown'
  return parsed.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function MemberManagement() {
  const { user, token, hasPermission } = useAuth()
  const { currentWorkspace, workspaceLoading } = useWorkspace()
  const canInviteMembers = hasPermission('invite_members')
  const workspaceId = currentWorkspace?.id ?? null

  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MemberRole>('member')
  const [inviteLoading, setInviteLoading] = useState(false)

  const [teamName, setTeamName] = useState('')
  const [teamDescription, setTeamDescription] = useState('')
  const [selectedTeamMemberIds, setSelectedTeamMemberIds] = useState<string[]>([])
  const [teamDialogOpen, setTeamDialogOpen] = useState(false)

  useEffect(() => {
    if (!workspaceId && !user?.tenant.slug) return
    const storageKey = `bokito_members_teams_${workspaceId ?? user?.tenant.slug ?? 'default'}`
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) {
        setTeams([])
        return
      }
      const parsed = JSON.parse(raw) as Team[]
      setTeams(Array.isArray(parsed) ? parsed : [])
    } catch {
      setTeams([])
    }
  }, [workspaceId, user?.tenant.slug])

  useEffect(() => {
    if (!workspaceId && !user?.tenant.slug) return
    const storageKey = `bokito_members_teams_${workspaceId ?? user?.tenant.slug ?? 'default'}`
    localStorage.setItem(storageKey, JSON.stringify(teams))
  }, [teams, workspaceId, user?.tenant.slug])

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const fallbackMember: Member[] = user
          ? [
              {
                id: String(user.id),
                name: user.name,
                email: user.email,
                role: asRole(user.role),
                isCurrentUser: true,
              },
            ]
          : []

        if (!workspaceId) {
          setMembers(fallbackMember)
          setInvites([])
          return
        }

        const [rawMembers, rawInvites] = await Promise.all([
          apiGet<unknown[]>(appRoutes.workspaces.members(workspaceId), token).catch(() => []),
          apiGet<unknown[]>(appRoutes.workspaces.invites(workspaceId), token).catch(() => []),
        ])

        const mappedMembers = Array.isArray(rawMembers)
          ? rawMembers
              .map((item) => {
                const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
                if (!row) return null
                const id = row.id ?? row.user_id ?? row.member_id
                const name = typeof row.name === 'string' ? row.name : typeof row.full_name === 'string' ? row.full_name : ''
                const email = typeof row.email === 'string' ? row.email : ''
                if (id == null || !name) return null
                return {
                  id: String(id),
                  name,
                  email,
                  role: asRole(row.role),
                  isCurrentUser: String(id) === String(user?.id),
                } satisfies Member
              })
              .filter((row): row is Member => row !== null)
          : []

        const mergedMembers = mappedMembers.length > 0 ? mappedMembers : fallbackMember
        if (user && !mergedMembers.some((member) => member.isCurrentUser)) {
          mergedMembers.unshift({
            id: String(user.id),
            name: user.name,
            email: user.email,
            role: asRole(user.role),
            isCurrentUser: true,
          })
        }
        setMembers(mergedMembers)

        const mappedInvites = Array.isArray(rawInvites)
          ? rawInvites
              .map((item) => {
                const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
                if (!row) return null
                const id = row.id ?? row.invite_id ?? row.uuid
                const email = typeof row.email === 'string' ? row.email : ''
                if (id == null || !email) return null
                return {
                  id: String(id),
                  email,
                  role: asRole(row.role),
                  invitedBy: typeof row.invited_by_name === 'string' ? row.invited_by_name : typeof row.invited_by === 'string' ? row.invited_by : 'Unknown',
                  invitedAt: typeof row.invited_at === 'string' ? row.invited_at : null,
                } satisfies Invite
              })
              .filter((row): row is Invite => row !== null)
          : []
        setInvites(mappedInvites)
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Kon members niet laden'
        setError(message)
        setMembers(
          user
            ? [
                {
                  id: String(user.id),
                  name: user.name,
                  email: user.email,
                  role: asRole(user.role),
                  isCurrentUser: true,
                },
              ]
            : [],
        )
        setInvites([])
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [token, user, workspaceId, workspaceLoading])

  const memberNameById = useMemo(() => {
    return Object.fromEntries(members.map((member) => [member.id, member.name]))
  }, [members])

  const handleInvite = async () => {
    if (!token || !workspaceId || !inviteEmail.trim()) return
    setInviteLoading(true)
    setError(null)
    try {
      await apiPost(
        appRoutes.workspaceInvites.create,
        {
          workspace_id: workspaceId,
          email: inviteEmail.trim(),
          role: inviteRole,
        },
        token,
      )
      const inviteList = await apiGet<unknown[]>(appRoutes.workspaces.invites(workspaceId), token).catch(() => [])
      const mappedInvites = Array.isArray(inviteList)
        ? inviteList
            .map((item) => {
              const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
              if (!row) return null
              const id = row.id ?? row.invite_id ?? row.uuid
              const email = typeof row.email === 'string' ? row.email : ''
              if (id == null || !email) return null
              return {
                id: String(id),
                email,
                role: asRole(row.role),
                invitedBy: typeof row.invited_by_name === 'string' ? row.invited_by_name : typeof row.invited_by === 'string' ? row.invited_by : 'Unknown',
                invitedAt: typeof row.invited_at === 'string' ? row.invited_at : null,
              } satisfies Invite
            })
            .filter((row): row is Invite => row !== null)
        : []
      setInvites(mappedInvites)
      setInviteEmail('')
      setInviteRole('member')
    } catch (inviteError) {
      const message = inviteError instanceof Error ? inviteError.message : 'Failed to send invitation'
      setError(message)
    } finally {
      setInviteLoading(false)
    }
  }

  const createTeam = () => {
    if (!teamName.trim()) return
    const next: Team = {
      id: crypto.randomUUID(),
      name: teamName.trim(),
      description: teamDescription.trim(),
      memberIds: selectedTeamMemberIds,
    }
    setTeams((current) => [next, ...current])
    setTeamName('')
    setTeamDescription('')
    setSelectedTeamMemberIds([])
  }

  const toggleSelectedMember = (memberId: string) => {
    setSelectedTeamMemberIds((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    )
  }

  const removeTeam = (teamId: string) => {
    setTeams((current) => current.filter((team) => team.id !== teamId))
  }

  type FilterTab = 'all' | 'active' | 'pending' | 'deactivated'
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')

  type UnifiedRow =
    | { kind: 'member'; data: Member }
    | { kind: 'invite'; data: Invite }

  const allRows: UnifiedRow[] = useMemo(() => [
    ...members.map((m): UnifiedRow => ({ kind: 'member', data: m })),
    ...invites.map((i): UnifiedRow => ({ kind: 'invite', data: i })),
  ], [members, invites])

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase()
    return allRows.filter((row) => {
      if (filterTab === 'active' && row.kind !== 'member') return false
      if (filterTab === 'pending' && row.kind !== 'invite') return false
      if (filterTab === 'deactivated') return false
      const text = row.kind === 'member'
        ? `${row.data.name} ${row.data.email}`.toLowerCase()
        : row.data.email.toLowerCase()
      return !q || text.includes(q)
    })
  }, [allRows, filterTab, search])

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: 'Alle', count: members.length + invites.length },
    { id: 'active', label: 'Actief', count: members.length },
    { id: 'pending', label: 'Pending', count: invites.length },
    { id: 'deactivated', label: 'Gedeactiveerd', count: 0 },
  ]

  return (
    <PageContent width="xl" className="space-y-5">
      <p className="text-sm text-text-secondary">
        Beheer leden, uitnodigingen en teams binnen je workspace.
      </p>

      {error ? (
        <div className="rounded-lg border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      {/* Invite bar */}
      <Card className="space-y-4 p-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-heading">Lid uitnodigen</p>
          <p className="text-sm text-text-secondary">Nodig een nieuw teamlid uit met de juiste rol.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_auto]">
          <Input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="naam@bedrijf.nl"
            disabled={!canInviteMembers || !workspaceId || inviteLoading}
          />
          <Select value={inviteRole} onValueChange={(value) => setInviteRole(asRole(value))} disabled={!canInviteMembers}>
            <SelectTrigger>
              <SelectValue placeholder="Rol" />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void handleInvite()} disabled={!canInviteMembers || !workspaceId || !inviteEmail.trim() || inviteLoading}>
            <MailPlus size={14} />
            {inviteLoading ? 'Versturen...' : 'Uitnodigen'}
          </Button>
        </div>
      </Card>

      {/* Unified members table */}
      <Card className="p-0 overflow-hidden">
        {/* Header with tabs + search */}
        <div className="flex items-center justify-between gap-4 border-b border-border/55 px-5 pt-4 pb-0">
          <div className="flex items-center gap-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 pb-3 text-[13px] font-medium border-b-2 transition-colors ${
                  filterTab === tab.id
                    ? 'border-accent text-text-heading'
                    : 'border-transparent text-text-muted hover:text-text-secondary'
                }`}
              >
                {tab.label}
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                  filterTab === tab.id ? 'bg-accent/15 text-accent' : 'bg-bg-hover text-text-muted'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          <div className="relative pb-3">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-[calc(50%+6px)] text-text-muted pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoeken..."
              className="pl-8 pr-3 py-1.5 text-[13px] bg-bg-input/60 border border-border/55 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/55 transition-colors w-48"
            />
          </div>
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Naam</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Status</TableHead>
              {(filterTab === 'all' || filterTab === 'pending') && <TableHead>Uitgenodigd door</TableHead>}
              {(filterTab === 'all' || filterTab === 'pending') && <TableHead>Datum</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-text-muted">Loading...</TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-text-muted">No results.</TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => {
                if (row.kind === 'member') {
                  const m = row.data
                  return (
                    <TableRow key={`m-${m.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatar name={m.name} email={m.email} size={26} />
                        <span>{m.name}</span>
                        {m.isCurrentUser ? <Badge variant="secondary">Jij</Badge> : null}
                      </div>
                    </TableCell>
                      <TableCell className="text-text-secondary">{m.email || '-'}</TableCell>
                      <TableCell><Badge variant="neutral">{m.role}</Badge></TableCell>
                      <TableCell><Badge variant="success">Actief</Badge></TableCell>
                      {(filterTab === 'all' || filterTab === 'pending') && <TableCell className="text-text-muted">-</TableCell>}
                      {(filterTab === 'all' || filterTab === 'pending') && <TableCell className="text-text-muted">-</TableCell>}
                    </TableRow>
                  )
                }
                const inv = row.data
                return (
                  <TableRow key={`i-${inv.id}`}>
                    <TableCell className="text-text-muted">-</TableCell>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell><Badge variant="neutral">{inv.role}</Badge></TableCell>
                    <TableCell><Badge variant="warning">Pending</Badge></TableCell>
                    {(filterTab === 'all' || filterTab === 'pending') && <TableCell className="text-text-secondary">{inv.invitedBy}</TableCell>}
                    {(filterTab === 'all' || filterTab === 'pending') && <TableCell className="text-text-secondary">{toDateLabel(inv.invitedAt)}</TableCell>}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Teams */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/55">
          <div>
            <p className="text-sm font-medium text-text-heading">Teams</p>
            <p className="text-xs text-text-secondary mt-0.5">Groepeer leden in teams voor overzicht en toewijzing.</p>
          </div>
          <Button size="sm" onClick={() => { setTeamName(''); setTeamDescription(''); setSelectedTeamMemberIds([]); setTeamDialogOpen(true) }}>
            <Plus size={13} />
            Team aanmaken
          </Button>
        </div>

        {teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="w-10 h-10 rounded-xl bg-bg-hover flex items-center justify-center">
              <Users size={18} className="text-text-muted" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-heading">No teams yet</p>
              <p className="text-xs text-text-secondary mt-0.5">Maak een team aan om leden te groeperen.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => { setTeamName(''); setTeamDescription(''); setSelectedTeamMemberIds([]); setTeamDialogOpen(true) }}>
              <Plus size={13} />
              Maak er een aan
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {teams.map((team) => (
              <div key={team.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                    <Users size={14} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-heading">{team.name}</p>
                    <p className="text-xs text-text-muted truncate">
                      {team.memberIds.length === 0
                        ? 'No members'
                        : team.memberIds.map((id) => memberNameById[id] ?? 'Unknown').join(', ')}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeTeam(team.id)} aria-label="Remove team">
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Team creation dialog */}
      {teamDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4">
          <div className="w-full max-w-md rounded-2xl border border-border/60 bg-bg-surface shadow-[0_20px_60px_rgba(5,8,18,0.5)]">
            <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
              <p className="text-[15px] font-semibold text-text-heading">Team aanmaken</p>
              <button type="button" onClick={() => setTeamDialogOpen(false)} className="text-text-muted hover:text-text-primary transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-text-muted">Teamnaam</label>
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="bijv. Support, Sales…" autoFocus />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-text-muted">Omschrijving <span className="text-text-muted/60 font-normal">(optioneel)</span></label>
                <Input value={teamDescription} onChange={(e) => setTeamDescription(e.target.value)} placeholder="Korte omschrijving van dit team" />
              </div>
              {members.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-text-muted">Leden toevoegen</label>
                  <div className="rounded-lg border border-border/55 divide-y divide-border/40 max-h-48 overflow-y-auto">
                    {members.map((member) => (
                      <label key={member.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg-hover/40 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTeamMemberIds.includes(member.id)}
                          onChange={() => toggleSelectedMember(member.id)}
                          className="accent-accent"
                        />
                        <UserAvatar name={member.name} email={member.email} size={24} />
                        <span className="text-sm text-text-primary">{member.name}</span>
                        {member.isCurrentUser && <span className="ml-auto text-[11px] text-text-muted">Jij</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border/50 px-5 py-3">
              <Button variant="secondary" size="sm" onClick={() => setTeamDialogOpen(false)}>Annuleren</Button>
              <Button size="sm" onClick={() => { createTeam(); setTeamDialogOpen(false) }} disabled={!teamName.trim()}>
                <Plus size={13} />
                Aanmaken
              </Button>
            </div>
          </div>
        </div>
      )}

    </PageContent>
  )
}