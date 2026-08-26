import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Link2, MailPlus, Search, Send, Trash2 } from 'lucide-react'
import { UserAvatar } from '../components/ui/UserAvatar'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { appRoutes } from '../api/routes/app.routes'
import { toast } from 'sonner'
import { appScopedDelete, appScopedGet, appScopedPatch, appScopedPost } from '../lib/api'
import { formatAppDate } from '../lib/app-locale'
import { inviteMailFeedback } from '../lib/invite-feedback'
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

// Canonical roles: backend memberships are owner | admin | member.
type MemberRole = 'owner' | 'admin' | 'member'

type Member = {
  id: string
  uuid: string | null
  name: string
  email: string
  role: MemberRole
  avatarUrl: string | null
  isCurrentUser: boolean
  joinedAt: string | null
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

export default function MemberManagement() {
  const { t, i18n } = useTranslation('nav')
  const { user, token, hasPermission } = useAuth()
  const { currentWorkspace, workspaceLoading } = useWorkspace()
  const canInviteMembers = hasPermission('invite_members')
  const canManageMembers = hasPermission('invite_members')
  const workspaceId = currentWorkspace?.id ?? null

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
    if (!window.confirm(t('membersPage.removeConfirm', { name: member.name }))) return
    setRowBusyId(member.id)
    setError(null)
    try {
      await appScopedDelete(appRoutes.workspaces.member(workspaceId, member.uuid ?? member.id), token)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('membersPage.removeError'))
    } finally {
      setRowBusyId(null)
    }
  }

  type FilterTab = 'all' | 'active' | 'pending'
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
      const text = row.kind === 'member'
        ? `${row.data.name} ${row.data.email}`.toLowerCase()
        : row.data.email.toLowerCase()
      return !q || text.includes(q)
    })
  }, [allRows, filterTab, search])

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: t('membersPage.tabAll'), count: members.length + invites.length },
    { id: 'active', label: t('membersPage.tabActive'), count: members.length },
    { id: 'pending', label: t('membersPage.tabPending'), count: invites.length },
  ]

  return (
    <PageContent width="xl" className="space-y-5">
      <p className="text-sm text-text-secondary">
        {t('membersPage.body')}
      </p>

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

      {/* Invite bar */}
      <Card id="member-invite" className="space-y-4 p-5 scroll-mt-24">
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-heading">{t('membersPage.inviteTitle')}</p>
          <p className="text-sm text-text-secondary">{t('membersPage.inviteBody')}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_auto]">
          <Input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder={t('membersPage.emailPlaceholder')}
            disabled={!canInviteMembers || !workspaceId || inviteLoading}
          />
          <Select value={inviteRole} onValueChange={(value) => setInviteRole(asRole(value))} disabled={!canInviteMembers}>
            <SelectTrigger>
              <SelectValue placeholder={t('membersPage.role')} />
            </SelectTrigger>
            <SelectContent>
              {INVITE_ROLE_VALUES.map((role) => (
                <SelectItem key={role} value={role}>
                  {t(`membersPage.roles.${role}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void handleInvite()} disabled={!canInviteMembers || !workspaceId || !inviteEmail.trim() || inviteLoading}>
            <MailPlus size={14} />
            {inviteLoading ? t('membersPage.sending') : t('membersPage.invite')}
          </Button>
        </div>
      </Card>

      {/* Unified members table */}
      <Card className="p-0 overflow-hidden">
        {/* Header with tabs + search */}
        <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 pt-4 pb-0">
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
              placeholder={t('membersPage.search')}
              className="pl-8 pr-3 py-1.5 text-[13px] bg-bg-input/60 border border-border/60 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/55 transition-colors w-48"
            />
          </div>
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('membersPage.colName')}</TableHead>
              <TableHead>{t('membersPage.colEmail')}</TableHead>
              <TableHead>{t('membersPage.colRole')}</TableHead>
              <TableHead>{t('membersPage.colStatus')}</TableHead>
              <TableHead>{t('membersPage.colInvitedBy')}</TableHead>
              <TableHead>{t('membersPage.colDate')}</TableHead>
              <TableHead className="w-[120px] text-right">{t('membersPage.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-text-muted">{t('membersPage.loading')}</TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="py-6 text-center">
                    <p className="text-sm text-text-muted">{t('membersPage.empty')}</p>
                    <p className="mt-1 text-xs text-text-muted">{t('membersPage.emptyHint')}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      {canInviteMembers ? (
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
                  return (
                    <TableRow key={`m-${m.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserAvatar name={m.name} email={m.email} avatarUrl={m.avatarUrl} size={26} />
                          <span>{m.name}</span>
                          {m.isCurrentUser ? <Badge variant="secondary">{t('membersPage.you')}</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-text-secondary">{m.email || '-'}</TableCell>
                      <TableCell>
                        {canManageMembers && !m.isCurrentUser ? (
                          <Select
                            value={m.role}
                            onValueChange={(value) => void changeMemberRole(m, asRole(value))}
                            disabled={busy}
                          >
                            <SelectTrigger className="h-7 w-[110px] text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MEMBER_ROLE_VALUES.map((role) => (
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
                      <TableCell><Badge variant="success">{t('membersPage.statusActive')}</Badge></TableCell>
                      <TableCell className="text-text-muted">-</TableCell>
                      <TableCell className="text-text-secondary">
                        {m.joinedAt ? toDateLabel(m.joinedAt, t('membersPage.unknown'), i18n.language) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManageMembers && !m.isCurrentUser ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void removeMember(m)}
                            title={t('membersPage.removeTitle')}
                            className="text-text-muted hover:text-status-error"
                          >
                            <Trash2 size={14} />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                }
                const inv = row.data
                const busy = rowBusyId === inv.id
                return (
                  <TableRow key={`i-${inv.id}`}>
                    <TableCell className="text-text-muted">-</TableCell>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell><Badge variant="neutral">{t(`membersPage.roles.${inv.role}`)}</Badge></TableCell>
                    <TableCell><Badge variant="warning">{t('membersPage.statusPending')}</Badge></TableCell>
                    <TableCell className="text-text-secondary">{inv.invitedBy}</TableCell>
                    <TableCell className="text-text-secondary">{toDateLabel(inv.invitedAt, t('membersPage.unknown'), i18n.language)}</TableCell>
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
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </PageContent>
  )
}
