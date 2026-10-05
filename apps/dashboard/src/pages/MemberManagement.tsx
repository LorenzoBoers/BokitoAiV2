import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ExternalLink, Link2, MailPlus, RotateCcw, Search, Send, Trash2, UserMinus } from 'lucide-react'
import { AiAvatar } from '../components/ui/AiAvatar'
import { UserAvatar } from '../components/ui/UserAvatar'
import { toAiAvatarProps } from '../lib/agent-avatar'
import {
  type OverviewAgent,
  type PresenceStatus,
} from '../lib/teams-api'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { appRoutes } from '../api/routes/app.routes'
import { toast } from 'sonner'
import { appScopedDelete, appScopedGet, appScopedPatch, appScopedPost } from '../lib/api'
import { archiveAgent, restoreAgent } from '../lib/workforce-api'
import { agentAutonomyLevelLabel } from '../lib/labels'
import { presenceBadgeVariant, presenceLabel, asAgentStatus } from '../lib/presence'
import { formatAppDate } from '../lib/app-locale'
import { inviteMailFeedback } from '../lib/invite-feedback'
import { isLikelyEmail } from '../lib/invite-email'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'

// Canonical roles: backend memberships are owner | admin | member.
type MemberRole = 'owner' | 'admin' | 'member'
type FilterTab = 'all' | 'people' | 'agents' | 'pending' | 'deactivated'

function directoryTabCountClass(id: FilterTab, selected: boolean): string {
  if (!selected) return 'bg-bg-hover text-text-muted'
  if (id === 'agents') return 'bg-ai/10 text-ai-ink'
  if (id === 'pending') return 'bg-status-warning/10 text-status-warning'
  if (id === 'deactivated') return 'bg-status-error/10 text-status-error'
  return 'bg-accent/15 text-accent'
}

function directoryTabBorderClass(id: FilterTab, selected: boolean): string {
  if (!selected) return 'border-transparent text-text-muted hover:text-text-secondary'
  if (id === 'agents') return 'border-ai text-text-heading'
  if (id === 'pending') return 'border-status-warning text-text-heading'
  if (id === 'deactivated') return 'border-status-error text-text-heading'
  return 'border-accent text-text-heading'
}

type Member = {
  id: string
  uuid: string | null
  name: string
  email: string
  role: MemberRole
  avatarUrl: string | null
  isCurrentUser: boolean
  joinedAt: string | null
  isActive: boolean
}

type Invite = {
  id: string
  email: string
  role: MemberRole
  invitedBy: string
  invitedAt: string | null
  inviteLink: string | null
}

// Owner is assigned via the member row controls, not via invites.
const INVITE_ROLE_VALUES: MemberRole[] = ['admin', 'member']
const MEMBER_ROLE_VALUES: MemberRole[] = ['owner', 'admin', 'member']

function asRole(value: unknown): MemberRole {
  const normalized = typeof value === 'string' ? value.toLowerCase() : ''
  if (normalized === 'owner' || normalized === 'admin') return normalized
  return 'member'
}

function toDateLabel(value: string | null, unknownLabel: string, language?: string | null): string {
  if (!value) return unknownLabel
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return unknownLabel
  return formatAppDate(parsed, language, { day: 'numeric', month: 'short', year: 'numeric' })
}

function mapMemberRow(item: unknown, currentUserId: string | undefined): Member | null {
  const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
  if (!row) return null
  const id = row.id ?? row.user_id ?? row.member_id
  const name = typeof row.name === 'string' ? row.name : typeof row.full_name === 'string' ? row.full_name : ''
  const email = typeof row.email === 'string' ? row.email : ''
  if (id == null || !name) return null
  return {
    id: String(id),
    uuid: typeof row.uuid === 'string' ? row.uuid : null,
    name,
    email,
    role: asRole(row.role),
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    isCurrentUser: String(id) === String(currentUserId),
    joinedAt: typeof row.joined_at === 'string' ? row.joined_at : null,
    isActive: row.is_active !== false,
  }
}

function mapInviteRow(item: unknown, unknownLabel: string): Invite | null {
  const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
  if (!row) return null
  const id = row.id ?? row.invite_id ?? row.uuid
  const email = typeof row.email === 'string' ? row.email : ''
  if (id == null || !email) return null
  return {
    id: String(id),
    email,
    role: asRole(row.role),
    invitedBy:
      typeof row.invited_by_name === 'string'
        ? row.invited_by_name
        : typeof row.invited_by === 'string'
          ? row.invited_by
          : unknownLabel,
    invitedAt: typeof row.invited_at === 'string' ? row.invited_at : null,
    inviteLink: typeof row.invite_link === 'string' ? row.invite_link : null,
  }
}

export type MemberMeta = { presence: PresenceStatus; teams: string[]; openOwned: number; openTurn: number }

/** Directory on Team: people, pending invites and company agents. */
export default function MemberManagement({
  metaByUuid,
  agents = [],
  teamNames = {},
  onChanged,
}: {
  /** Availability, teams and workload per user UUID. */
  metaByUuid?: Record<string, MemberMeta>
  agents?: OverviewAgent[]
  teamNames?: Record<string, string>
  onChanged?: () => void
} = {}) {
  const { t, i18n } = useTranslation('nav')
  const { t: tCommon } = useTranslation('common')
  const { user, token, hasPermission } = useAuth()
  const { currentWorkspace, workspaceLoading } = useWorkspace()
  const canInviteMembers = hasPermission('invite_members')
  const canManageMembers = hasPermission('invite_members')
  // Staff support defaults to admin in memberships; real owner membership wins.
  const membershipRole = user?.memberships?.find(
    (m) => String(m.tenantId) === String(user.organisationId),
  )?.role
  const isWorkspaceOwner = membershipRole === 'owner' || (!user?.isStaff && user?.role === 'owner')
  const workspaceId = currentWorkspace?.id ?? null

  const canEditMemberRow = (member: Member) =>
    canManageMembers && !member.isCurrentUser && (member.role !== 'owner' || isWorkspaceOwner)

  const roleOptionsFor = (_member: Member): MemberRole[] =>
    isWorkspaceOwner ? MEMBER_ROLE_VALUES : INVITE_ROLE_VALUES

  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MemberRole>('member')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  // null = unknown (still loading / request failed); only an explicit false
  // shows the "mail not configured" warning banner to admins.
  const [mailConfigured, setMailConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    if (!token || !canInviteMembers) return
    appScopedGet<{ configured?: boolean }>(appRoutes.mailStatus, token)
      .then((status) => setMailConfigured(status?.configured === true))
      .catch(() => setMailConfigured(null))
  }, [token, canInviteMembers])

  const reload = useCallback(async () => {
    if (!token || !workspaceId) return
    const [rawMembers, rawInvites] = await Promise.all([
      // Members failures must surface (outer catch shows the error banner);
      // invites 403 for non-admins, so an empty fallback is legitimate there.
      appScopedGet<unknown[]>(appRoutes.workspaces.members(workspaceId), token),
      appScopedGet<unknown[]>(appRoutes.workspaces.invites(workspaceId), token).catch(() => []),
    ])
    const mappedMembers = Array.isArray(rawMembers)
      ? rawMembers.map((row) => mapMemberRow(row, user ? String(user.id) : undefined)).filter((r): r is Member => r !== null)
      : []
    if (user && !mappedMembers.some((m) => m.isCurrentUser)) {
      mappedMembers.unshift({
        id: String(user.id),
        uuid: null,
        name: user.name,
        email: user.email,
        role: asRole(user.role),
        avatarUrl: user.avatarUrl ?? null,
        isCurrentUser: true,
        joinedAt: null,
        isActive: true,
      })
    }
    setMembers(mappedMembers)
    setInvites(
      Array.isArray(rawInvites)
        ? rawInvites.map((row) => mapInviteRow(row, t('membersPage.unknown'))).filter((r): r is Invite => r !== null)
        : [],
    )
  }, [token, workspaceId, user, t])

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        if (!workspaceId) {
          setMembers(
            user
              ? [{
                  id: String(user.id),
                  uuid: null,
                  name: user.name,
                  email: user.email,
                  role: asRole(user.role),
                  avatarUrl: user.avatarUrl ?? null,
                  isCurrentUser: true,
                  joinedAt: null,
                  isActive: true,
                }]
              : [],
          )
          setInvites([])
          return
        }
        await reload()
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : t('membersPage.loadError'))
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [token, user, workspaceId, workspaceLoading, reload])

  /** Surface delivery state: when mail is not configured the invite still
   * exists and the copyable link is the only way to reach the invitee. */
  const notifyInviteResult = async (email: string, result: unknown) => {
    const feedback = inviteMailFeedback(email, result)
    if (feedback.kind === 'warning') {
      if (feedback.inviteLink) {
        try {
          await navigator.clipboard.writeText(feedback.inviteLink)
        } catch {
          // Clipboard can be unavailable; the copy-link row action still works.
        }
      }
      toast.warning(feedback.message, { duration: 8000 })
      return
    }
    toast.success(feedback.message)
  }

  const handleInvite = async () => {
    if (!token || !workspaceId || !inviteEmail.trim()) return
    const email = inviteEmail.trim()
    if (!isLikelyEmail(email)) {
      setError(t('membersPage.invalidEmail'))
      return
    }
    setInviteLoading(true)
    setError(null)
    try {
      const result = await appScopedPost(
        appRoutes.workspaceInvites.create,
        { workspace_id: workspaceId, email, role: inviteRole },
        token,
      )
      await reload()
      await notifyInviteResult(email, result)
      setInviteEmail('')
      setInviteRole('member')
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : t('membersPage.inviteError'))
    } finally {
      setInviteLoading(false)
    }
  }

  const resendInvite = async (invite: Invite) => {
    if (!token || !workspaceId) return
    setRowBusyId(invite.id)
    setError(null)
    try {
      const result = await appScopedPost(
        appRoutes.workspaces.inviteResend(workspaceId, invite.id),
        {},
        token,
      )
      await reload()
      await notifyInviteResult(invite.email, result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('membersPage.resendError'))
    } finally {
      setRowBusyId(null)
    }
  }

  const copyInviteLink = async (invite: Invite) => {
    if (!invite.inviteLink) return
    try {
      await navigator.clipboard.writeText(invite.inviteLink)
      setCopiedInviteId(invite.id)
      window.setTimeout(() => setCopiedInviteId((prev) => (prev === invite.id ? null : prev)), 1600)
    } catch {
      setError(t('membersPage.copyError'))
    }
  }

  const revokeInvite = async (invite: Invite) => {
    if (!token || !workspaceId) return
    if (!window.confirm(t('membersPage.revokeConfirm', { email: invite.email }))) return
    setRowBusyId(invite.id)
    setError(null)
    try {
      await appScopedDelete(appRoutes.workspaces.invite(workspaceId, invite.id), token)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('membersPage.revokeError'))
    } finally {
      setRowBusyId(null)
    }
  }

  const changeMemberRole = async (member: Member, role: MemberRole) => {
    if (!token || !workspaceId || member.role === role) return
    if (!canEditMemberRow(member)) return
    if ((role === 'owner' || member.role === 'owner') && !isWorkspaceOwner) {
      setError(t('membersPage.ownerOnlyError'))
      return
    }
    if (role === 'owner' && !window.confirm(t('membersPage.ownerConfirm', { name: member.name }))) return
    setRowBusyId(member.id)
    setError(null)
    try {
      await appScopedPatch(
        appRoutes.workspaces.member(workspaceId, member.uuid ?? member.id),
        { role },
        token,
      )
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('membersPage.roleError'))
    } finally {
      setRowBusyId(null)
    }
  }

  const removeMember = async (member: Member) => {
    if (!token || !workspaceId) return
    if (!canEditMemberRow(member)) return
    if (member.role === 'owner' && !isWorkspaceOwner) {
      setError(t('membersPage.ownerOnlyError'))
      return
    }
    if (!window.confirm(t('membersPage.removeConfirm', { name: member.name }))) return
    setRowBusyId(member.id)
    setError(null)
    try {
      await appScopedDelete(appRoutes.workspaces.member(workspaceId, member.uuid ?? member.id), token)
      await reload()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('membersPage.removeError'))
    } finally {
      setRowBusyId(null)
    }
  }

  const reactivateMember = async (member: Member) => {
    if (!token || !workspaceId) return
    if (!canEditMemberRow(member) && member.role === 'owner' && !isWorkspaceOwner) {
      setError(t('membersPage.ownerOnlyError'))
      return
    }
    if (!window.confirm(t('membersPage.reactivateConfirm', { name: member.name }))) return
    setRowBusyId(member.id)
    setError(null)
    try {
      await appScopedPost(
        appRoutes.workspaces.memberReactivate(workspaceId, member.uuid ?? member.id),
        {},
        token,
      )
      await reload()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('membersPage.removeError'))
    } finally {
      setRowBusyId(null)
    }
  }

  const deactivateAgent = async (agent: OverviewAgent) => {
    if (!token || !canManageMembers) return
    if (!window.confirm(t('workforce.agents.archiveConfirm'))) return
    setRowBusyId(agent.id)
    setError(null)
    try {
      await archiveAgent(token, agent.id)
      await reload()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workforce.agents.archiveError'))
    } finally {
      setRowBusyId(null)
    }
  }

  const reactivateAgent = async (agent: OverviewAgent) => {
    if (!token || !canManageMembers) return
    if (!window.confirm(t('membersPage.reactivateConfirm', { name: agent.name }))) return
    setRowBusyId(agent.id)
    setError(null)
    try {
      await restoreAgent(token, agent.id)
      await reload()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workforce.agents.restoreError'))
    } finally {
      setRowBusyId(null)
    }
  }

  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')

  type UnifiedRow =
    | { kind: 'member'; data: Member }
    | { kind: 'invite'; data: Invite }
    | { kind: 'agent'; data: OverviewAgent }

  const agentTeamLabels = useCallback(
    (teamIds: string[]) =>
      teamIds
        .map((id) => teamNames[id])
        .filter((name): name is string => Boolean(name)),
    [teamNames],
  )

  const allRows: UnifiedRow[] = useMemo(() => [
    ...members.map((m): UnifiedRow => ({ kind: 'member', data: m })),
    ...invites.map((i): UnifiedRow => ({ kind: 'invite', data: i })),
    ...agents.map((a): UnifiedRow => ({ kind: 'agent', data: a })),
  ], [members, invites, agents])

  const activePeople = members.filter((m) => m.isActive)
  const activeAgents = agents.filter((a) => !a.deactivated)
  const deactivatedPeople = members.filter((m) => !m.isActive)
  const deactivatedAgents = agents.filter((a) => Boolean(a.deactivated))

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim()
    return allRows.filter((row) => {
      const deactivated =
        (row.kind === 'member' && !row.data.isActive) || (row.kind === 'agent' && Boolean(row.data.deactivated))
      if (filterTab === 'deactivated') {
        if (!deactivated) return false
      } else {
        if (deactivated) return false
        if (filterTab === 'people' && row.kind !== 'member') return false
        if (filterTab === 'agents' && row.kind !== 'agent') return false
        if (filterTab === 'pending' && row.kind !== 'invite') return false
      }
      if (!q) return true
      if (row.kind === 'member') return `${row.data.name} ${row.data.email}`.toLowerCase().includes(q)
      if (row.kind === 'invite') return row.data.email.toLowerCase().includes(q)
      return row.data.name.toLowerCase().includes(q)
    })
  }, [allRows, filterTab, search])

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: t('membersPage.tabAll'), count: activePeople.length + invites.length + activeAgents.length },
    { id: 'people', label: t('membersPage.tabPeople'), count: activePeople.length },
    { id: 'agents', label: t('membersPage.tabAgents'), count: activeAgents.length },
    { id: 'pending', label: t('membersPage.tabPending'), count: invites.length },
    { id: 'deactivated', label: t('membersPage.tabDeactivated'), count: deactivatedPeople.length + deactivatedAgents.length },
  ]

  const colSpan = 7

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-lg border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      {mailConfigured === false && canInviteMembers ? (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm text-status-warning">
          {t('membersPage.mailNotConfigured')}
        </div>
      ) : null}

      <Card id="member-invite" className="space-y-3 p-4 scroll-mt-24">
        <p className="text-sm font-medium text-text-heading">{t('membersPage.inviteTitle')}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px_auto]">
          <Input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleInvite()
              }
            }}
            placeholder={t('membersPage.emailPlaceholder')}
            disabled={!canInviteMembers || !workspaceId || inviteLoading}
          />
          <Select value={inviteRole} onValueChange={(value) => setInviteRole(asRole(value))} disabled={!canInviteMembers}>
            <SelectTrigger>
              <SelectValue placeholder={t('membersPage.role')} />
            </SelectTrigger>
            <SelectContent>
              {INVITE_ROLE_VALUES.map((role) => (
                <SelectItem key={role} value={role} title={t(`membersPage.roleHint.${role}`)}>
                  {t(`membersPage.roles.${role}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void handleInvite()} disabled={!canInviteMembers || !workspaceId || !isLikelyEmail(inviteEmail) || inviteLoading}>
            <MailPlus size={14} />
            {inviteLoading ? t('membersPage.sending') : t('membersPage.invite')}
          </Button>
        </div>
        <p className="text-xs text-text-muted">{t(`membersPage.roleHint.${inviteRole}`)}</p>
        <details className="group rounded-lg border border-border/60 bg-bg-input/30 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-text-heading [&::-webkit-details-marker]:hidden">
            <span>{t('membersPage.roleMatrixTitle')}</span>
            <ChevronDown size={14} className="shrink-0 text-text-muted transition-transform group-open:rotate-180" />
          </summary>
          <table className="mt-2 w-full text-left text-xs text-text-muted">
            <thead>
              <tr>
                <th className="py-0.5 font-medium text-text-secondary" />
                <th className="py-0.5 font-medium text-text-secondary">{t('membersPage.roles.owner')}</th>
                <th className="py-0.5 font-medium text-text-secondary">{t('membersPage.roles.admin')}</th>
                <th className="py-0.5 font-medium text-text-secondary">{t('membersPage.roles.member')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-0.5">{t('membersPage.roleMatrix.invite')}</td>
                <td>{t('membersPage.roleMatrix.owner')}</td>
                <td>{t('membersPage.roleMatrix.admin')}</td>
                <td>{t('membersPage.roleMatrix.memberNo')}</td>
              </tr>
              <tr>
                <td className="py-0.5">{t('membersPage.roleMatrix.agents')}</td>
                <td>{t('membersPage.roleMatrix.owner')}</td>
                <td>{t('membersPage.roleMatrix.admin')}</td>
                <td>{t('membersPage.roleMatrix.memberNo')}</td>
              </tr>
              <tr>
                <td className="py-0.5">{t('membersPage.roleMatrix.inbox')}</td>
                <td>{t('membersPage.roleMatrix.owner')}</td>
                <td>{t('membersPage.roleMatrix.admin')}</td>
                <td>{t('membersPage.roleMatrix.owner')}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </Card>

      <Card id="directory" className="overflow-hidden p-0 scroll-mt-24">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 pt-3 pb-0">
          <div className="flex flex-wrap items-center gap-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 pb-3 text-sm font-medium border-b-2 transition-colors ${directoryTabBorderClass(tab.id, filterTab === tab.id)}`}
              >
                {tab.label}
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${directoryTabCountClass(tab.id, filterTab === tab.id)}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          <div className="relative pb-3">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-[calc(50%+6px)] text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('membersPage.searchDirectory')}
              className="w-52 rounded-lg border border-border/60 bg-bg-input/60 py-1.5 pl-8 pr-3 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-accent/55 focus:outline-none"
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('membersPage.colName')}</TableHead>
              <TableHead>{t('membersPage.colType')}</TableHead>
              <TableHead>{t('membersPage.colRoleOrCeiling')}</TableHead>
              <TableHead>{t('membersPage.colTeams')}</TableHead>
              <TableHead>{t('membersPage.colOpen')}</TableHead>
              <TableHead>{t('membersPage.colStatus')}</TableHead>
              <TableHead className="w-[120px] text-right">{t('membersPage.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-sm text-text-muted">{t('membersPage.loading')}</TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan}>
                  <div className="py-6 text-center">
                    <p className="text-sm text-text-muted">{t('membersPage.empty')}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {search.trim() || filterTab !== 'all'
                        ? t('membersPage.emptyFiltered')
                        : canInviteMembers
                          ? t('membersPage.emptyHint')
                          : t('membersPage.askAdminEmpty')}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      {search.trim() || filterTab !== 'all' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch('')
                            setFilterTab('all')
                          }}
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                        >
                          {t('membersPage.clearFilters')}
                        </button>
                      ) : canInviteMembers ? (
                        <a
                          href="#member-invite"
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
                        >
                          {t('membersPage.inviteFromEmpty')}
                        </a>
                      ) : null}
                      <Link
                        to="/settings/setup"
                        className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover/60"
                      >
                        {t('membersPage.openSetup')}
                      </Link>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => {
                if (row.kind === 'member') {
                  const m = row.data
                  const busy = rowBusyId === m.id
                  const meta = m.uuid ? metaByUuid?.[m.uuid] : undefined
                  return (
                    <TableRow key={`m-${m.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserAvatar
                            name={m.name}
                            email={m.email}
                            avatarUrl={m.avatarUrl}
                            size={26}
                            presence={meta?.presence}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate-fade font-medium text-text-primary">{m.name}</span>
                              {m.isCurrentUser ? <Badge variant="secondary">{t('membersPage.you')}</Badge> : null}
                            </div>
                            {m.email ? (
                              <p className="truncate-fade text-xs text-text-muted">{m.email}</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral">{t('membersPage.typePerson')}</Badge>
                      </TableCell>
                      <TableCell>
                        {canEditMemberRow(m) && m.isActive ? (
                          <Select
                            value={m.role}
                            onValueChange={(value) => void changeMemberRole(m, asRole(value))}
                            disabled={busy}
                          >
                            <SelectTrigger className="h-7 w-[110px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {roleOptionsFor(m).map((role) => (
                                <SelectItem key={role} value={role}>
                                  {t(`membersPage.roles.${role}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="neutral">{t(`membersPage.roles.${m.role}`)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {meta?.teams.length ? meta.teams.join(', ') : '-'}
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {meta
                          ? [
                              t('teamPage.openCount', { count: meta.openOwned }),
                              meta.openTurn ? t('teamPage.turnCount', { count: meta.openTurn }) : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {m.isActive ? (
                          <Badge variant={presenceBadgeVariant(meta?.presence ?? 'offline')}>
                            {presenceLabel(meta?.presence ?? 'offline', tCommon)}
                          </Badge>
                        ) : (
                          <Badge variant={presenceBadgeVariant('deactivated')}>
                            {presenceLabel('deactivated', tCommon)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManageMembers && !m.isCurrentUser && (m.role !== 'owner' || isWorkspaceOwner) ? (
                          m.isActive ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void removeMember(m)}
                              title={t('membersPage.removeTitle')}
                              className="text-text-muted hover:text-status-error"
                            >
                              <UserMinus size={14} />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void reactivateMember(m)}
                              title={t('membersPage.reactivateTitle')}
                              className="text-text-muted hover:text-text-primary"
                            >
                              <RotateCcw size={14} />
                            </Button>
                          )
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                }

                if (row.kind === 'invite') {
                  const inv = row.data
                  const busy = rowBusyId === inv.id
                  return (
                    <TableRow key={`i-${inv.id}`}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate-fade font-medium text-text-primary">{inv.email}</p>
                          <p className="text-xs text-text-muted">
                            {t('membersPage.invitedByLine', {
                              name: inv.invitedBy,
                              date: toDateLabel(inv.invitedAt, t('membersPage.unknown'), i18n.language),
                            })}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral">{t('membersPage.typeInvite')}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral">{t(`membersPage.roles.${inv.role}`)}</Badge>
                      </TableCell>
                      <TableCell className="text-text-muted">-</TableCell>
                      <TableCell className="text-text-muted">-</TableCell>
                      <TableCell>
                        <Badge variant="warning">{t('membersPage.statusPending')}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canManageMembers ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void resendInvite(inv)}
                              title={t('membersPage.resendTitle')}
                              className="text-text-muted hover:text-text-primary"
                            >
                              <Send size={14} />
                            </Button>
                          ) : null}
                          {inv.inviteLink ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void copyInviteLink(inv)}
                              title={t('membersPage.copyTitle')}
                              className="text-text-muted hover:text-text-primary"
                            >
                              {copiedInviteId === inv.id ? <Check size={14} className="text-status-success" /> : <Link2 size={14} />}
                            </Button>
                          ) : null}
                          {canManageMembers ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void revokeInvite(inv)}
                              title={t('membersPage.revokeTitle')}
                              className="text-text-muted hover:text-status-error"
                            >
                              <Trash2 size={14} />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                }

                const agent = row.data
                const teams = agentTeamLabels(agent.team_ids)
                const deactivated = Boolean(agent.deactivated)
                const agentStatus = asAgentStatus(agent.status)
                const busy = rowBusyId === agent.id
                return (
                  <TableRow key={`a-${agent.id}`}>
                    <TableCell>
                      <Link to={`/agents/${agent.id}`} className="flex items-center gap-2 hover:underline">
                        <AiAvatar
                          {...toAiAvatarProps(agent)}
                          size={26}
                          activity={deactivated ? undefined : agentStatus}
                          decorative
                        />
                        <span className="font-medium text-text-primary">{agent.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">{t('membersPage.typeAgent')}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">
                        {agentAutonomyLevelLabel(agent.autonomy_level, t)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {teams.length ? teams.join(', ') : '-'}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {t('teamPage.openCount', { count: agent.open_owned })}
                    </TableCell>
                    <TableCell>
                      {deactivated ? (
                        <Badge variant={presenceBadgeVariant('deactivated')}>
                          {presenceLabel('deactivated', tCommon)}
                        </Badge>
                      ) : (
                        <Badge variant={presenceBadgeVariant(agentStatus)}>
                          {presenceLabel(agentStatus, tCommon)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" asChild className="text-text-muted hover:text-text-primary">
                          <Link to={`/agents/${agent.id}`} title={t('membersPage.openAgent')}>
                            <ExternalLink size={14} />
                          </Link>
                        </Button>
                        {canManageMembers ? (
                          deactivated ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void reactivateAgent(agent)}
                              title={t('membersPage.reactivateTitle')}
                              className="text-text-muted hover:text-text-primary"
                            >
                              <RotateCcw size={14} />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void deactivateAgent(agent)}
                              title={t('workforce.agents.archive')}
                              className="text-text-muted hover:text-status-error"
                            >
                              <UserMinus size={14} />
                            </Button>
                          )
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
